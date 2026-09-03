/// <reference types="@cloudflare/workers-types" />

/**
 * Le Worker qui sert le site ET l'arbre partagé.
 *
 * Sans lui, chaque appareil garde sa propre copie de l'arbre dans son
 * navigateur (`localStorage`) : un proche qui ouvre le site depuis son
 * téléphone ne voit jamais ce que tu as saisi depuis le tien. `FAMILY_KV`
 * (un espace de stockage Cloudflare, à créer une fois dans le tableau de
 * bord — voir `wrangler.jsonc`) devient la seule mémoire : tout le monde lit
 * et écrit au même endroit.
 *
 * Cloudflare Access protège déjà toutes les requêtes vers ce Worker (réglé
 * sur « All traffic » dans les réglages du Worker) — `/api/family` en
 * profite automatiquement, sans code d'authentification à écrire ici. Et
 * comme Access sait forcément QUI passe la porte, il le dit au Worker : c'est
 * de là que viennent l'accueil personnalisé et le journal des visites, sans
 * qu'on ait eu à créer le moindre compte (voir `identify` plus bas).
 */

export interface Env {
  ASSETS: Fetcher;
  FAMILY_KV: KVNamespace;
  /**
   * L'adresse de qui tient l'arbre — la seule à voir la liste des visites.
   *
   * Posée par `wrangler secret put OWNER_EMAIL`, jamais écrite dans le dépôt :
   * ce dépôt est public, et c'est une adresse personnelle. Non renseignée,
   * personne ne voit la liste — ce qui est le bon défaut.
   */
  OWNER_EMAIL?: string;
}

const FAMILY_KEY = 'family';
const CHANGELOG_KEY = 'changelog';
const VISITOR_PREFIX = 'visitor:';

/** Au-delà, les plus anciennes sortent : personne ne revient après deux ans
 *  d'absence pour lire soixante lignes de « qui a été ajouté ». */
const CHANGELOG_MAX = 60;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

/** Vérification minimale : on ne veut pas écraser l'arbre par n'importe
 *  quoi, mais la validation détaillée (dates, doublons…) reste au
 *  chargement côté application. */
function looksLikeFamilyDataset(value: unknown): value is { people: PersonLike[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { people?: unknown }).people)
  );
}

interface PersonLike {
  id?: unknown;
  firstName?: unknown;
  lastName?: unknown;
}

/** Une visite, une adresse. Une clé par personne plutôt qu'un seul objet
 *  commun : deux proches qui ouvrent le site à la même seconde écriraient
 *  sinon par-dessus le passage l'un de l'autre. */
interface VisitorRecord {
  email: string;
  firstSeen: string;
  lastSeen: string;
  visits: number;
  /** Qui cette personne est DANS l'arbre, si elle a bien voulu le dire. */
  personId?: string;
}

/** Ce qui a changé, et quand — de quoi dire « depuis votre dernière visite ». */
interface ChangeEntry {
  at: string;
  by: string;
  added: string[];
  removed: string[];
  edited: number;
}

/**
 * Qui est en train de regarder.
 *
 * Access pose deux marques sur chaque requête qu'il laisse passer : un
 * en-tête tout prêt avec l'adresse, et un jeton signé qui contient la même
 * chose. On prend le premier, et le second en secours.
 *
 * Ce jeton n'est volontairement PAS vérifié cryptographiquement ici. Ce
 * serait indispensable pour une origine joignable directement, où n'importe
 * qui pourrait fabriquer l'en-tête. Ce n'est pas le cas : ce Worker n'est
 * atteignable qu'à travers Access, et Cloudflare réécrit tout en-tête `Cf-*`
 * fourni par un client — un visiteur ne peut donc pas se déclarer quelqu'un
 * d'autre. Le seul pouvoir attaché à cette identité est de voir la liste des
 * visites, et il faudrait déjà avoir passé la porte pour essayer. Si un jour
 * ce Worker devait servir en dehors d'Access, il faudrait vérifier la
 * signature du jeton contre `.../cdn-cgi/access/certs` — voir la note de
 * Cloudflare sur la validation des JWT.
 */
function identify(request: Request): string | null {
  const direct = request.headers.get('Cf-Access-Authenticated-User-Email');
  if (direct) return direct.trim().toLowerCase();

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  const payload = token?.split('.')[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded)) as { email?: unknown };
    return typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Un prénom présentable, tiré de l'adresse.
 *
 * Un pis-aller, et assumé comme tel : `marie-ange.maillet@…` donne
 * « Marie-Ange », mais une adresse comme `mm1975@…` ne donnera jamais rien de
 * bon. C'est pour ça que l'accueil propose de se désigner dans l'arbre — dès
 * qu'une personne l'a fait, c'est son vrai prénom qui sert (voir `personId`).
 */
function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  const first = local.split(/[._+]/)[0] ?? local;
  return first
    .split('-')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join('-');
}

const personName = (person: PersonLike): string =>
  [person.firstName, person.lastName]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ')
    .trim();

/**
 * Ce qui distingue l'arbre qu'on enregistre de celui qu'il remplace.
 *
 * Comparé par identifiant : ce qui apparaît, ce qui disparaît, et le nombre
 * de fiches retouchées sans que personne n'entre ni ne sorte. Les retouches
 * se comptent mais ne se nomment pas — « Marie a été modifiée » n'apprend
 * rien à qui n'était pas là, alors que « Marie a été ajoutée » se comprend
 * seul.
 */
function diffPeople(before: PersonLike[], after: PersonLike[]): Omit<ChangeEntry, 'at' | 'by'> {
  const byId = (list: PersonLike[]): Map<string, PersonLike> => {
    const map = new Map<string, PersonLike>();
    for (const person of list) {
      if (typeof person?.id === 'string') map.set(person.id, person);
    }
    return map;
  };

  const old = byId(before);
  const now = byId(after);

  const added: string[] = [];
  const removed: string[] = [];
  let edited = 0;

  for (const [id, person] of now) {
    const previous = old.get(id);
    if (!previous) added.push(personName(person) || id);
    else if (JSON.stringify(previous) !== JSON.stringify(person)) edited += 1;
  }
  for (const [id, person] of old) {
    if (!now.has(id)) removed.push(personName(person) || id);
  }

  return { added, removed, edited };
}

async function readChangelog(env: Env): Promise<ChangeEntry[]> {
  const stored = await env.FAMILY_KV.get(CHANGELOG_KEY, 'json');
  return Array.isArray(stored) ? (stored as ChangeEntry[]) : [];
}

async function listVisitors(env: Env): Promise<VisitorRecord[]> {
  const keys = await env.FAMILY_KV.list({ prefix: VISITOR_PREFIX });
  const records = await Promise.all(
    keys.keys.map((key) => env.FAMILY_KV.get(key.name, 'json') as Promise<VisitorRecord | null>),
  );
  return records
    .filter((record): record is VisitorRecord => record !== null)
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    /*
     * ── Qui regarde, et ce qui a changé depuis son dernier passage ────────
     *
     * Une seule requête au chargement de la page. Elle lit l'état PRÉCÉDENT
     * du visiteur avant de le mettre à jour : c'est ce décalage d'un cran qui
     * permet de dire « depuis votre dernière visite » — une fois la réponse
     * partie, la date est avancée et le même rechargement n'annoncera plus
     * rien, ce qui est bien le comportement voulu.
     */
    if (url.pathname === '/api/visitor') {
      const email = identify(request);
      // Pas d'Access devant (développement local) : personne à saluer, et
      // surtout rien à écrire dans le journal des visites.
      if (!email) return json({ known: false });

      const key = `${VISITOR_PREFIX}${email}`;
      const previous = (await env.FAMILY_KV.get(key, 'json')) as VisitorRecord | null;

      if (request.method === 'PUT') {
        // « Je suis cette personne-là dans l'arbre. »
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: 'JSON invalide.' }, 400);
        }
        const personId = (body as { personId?: unknown }).personId;
        if (personId !== null && typeof personId !== 'string') {
          return json({ error: '« personId » doit être une chaîne, ou null.' }, 400);
        }
        const now = new Date().toISOString();
        const record: VisitorRecord = {
          email,
          firstSeen: previous?.firstSeen ?? now,
          lastSeen: previous?.lastSeen ?? now,
          visits: previous?.visits ?? 1,
          ...(personId ? { personId } : {}),
        };
        await env.FAMILY_KV.put(key, JSON.stringify(record));
        return new Response(null, { status: 204 });
      }

      if (request.method !== 'GET') return json({ error: 'Méthode non gérée.' }, 405);

      const now = new Date().toISOString();
      const record: VisitorRecord = previous
        ? { ...previous, lastSeen: now, visits: previous.visits + 1 }
        : { email, firstSeen: now, lastSeen: now, visits: 1 };
      await env.FAMILY_KV.put(key, JSON.stringify(record));

      // Ce qui a bougé depuis le dernier passage — sauf ce que cette
      // personne a fait elle-même : lui annoncer ses propres ajouts serait
      // lui apprendre ce qu'elle vient de faire.
      const since = previous?.lastSeen ?? null;
      const entries = since
        ? (await readChangelog(env)).filter((entry) => entry.at > since && entry.by !== email)
        : [];

      const owner = Boolean(env.OWNER_EMAIL) && email === env.OWNER_EMAIL!.trim().toLowerCase();

      return json({
        known: true,
        email,
        name: nameFromEmail(email),
        personId: previous?.personId ?? null,
        firstVisit: previous === null,
        lastVisit: since,
        visits: record.visits,
        owner,
        news: {
          added: entries.flatMap((entry) => entry.added),
          removed: entries.flatMap((entry) => entry.removed),
          edited: entries.reduce((total, entry) => total + entry.edited, 0),
        },
        ...(owner ? { visitors: await listVisitors(env) } : {}),
      });
    }

    // La liste des visites, pour qui tient l'arbre. Séparée de `/api/visitor`
    // pour pouvoir la rafraîchir sans repasser une visite au compteur.
    if (url.pathname === '/api/visitors') {
      const email = identify(request);
      const owner = Boolean(env.OWNER_EMAIL) && email === env.OWNER_EMAIL!.trim().toLowerCase();
      if (!owner) return json({ error: 'Réservé à qui tient l’arbre.' }, 403);
      return json({ visitors: await listVisitors(env) });
    }

    if (url.pathname === '/api/family') {
      if (request.method === 'GET') {
        const stored = await env.FAMILY_KV.get(FAMILY_KEY);
        return stored ? new Response(stored, { headers: { 'content-type': 'application/json; charset=utf-8' } }) : json(null);
      }

      if (request.method === 'PUT') {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: 'JSON invalide.' }, 400);
        }
        const entry = body as { dataset?: unknown };
        if (!looksLikeFamilyDataset(entry?.dataset)) {
          return json({ error: 'Format inattendu : « dataset.people » doit être une liste.' }, 400);
        }

        // Le journal se tient ici, au seul endroit où l'on voit à la fois
        // l'arbre d'avant et celui d'après.
        const previousRaw = await env.FAMILY_KV.get(FAMILY_KEY, 'json');
        const previousPeople =
          looksLikeFamilyDataset((previousRaw as { dataset?: unknown })?.dataset)
            ? ((previousRaw as { dataset: { people: PersonLike[] } }).dataset.people)
            : [];
        const change = diffPeople(previousPeople, entry.dataset.people);

        await env.FAMILY_KV.put(FAMILY_KEY, JSON.stringify(body));

        if (change.added.length > 0 || change.removed.length > 0 || change.edited > 0) {
          const log = await readChangelog(env);
          log.push({
            at: new Date().toISOString(),
            by: identify(request) ?? 'inconnu',
            ...change,
          });
          await env.FAMILY_KV.put(CHANGELOG_KEY, JSON.stringify(log.slice(-CHANGELOG_MAX)));
        }

        return new Response(null, { status: 204 });
      }

      /*
       * Il y avait ici un `DELETE` qui vidait l'arbre d'un coup. Plus rien ne
       * l'appelait depuis que la remise à zéro a quitté l'interface — mais il
       * restait joignable par quiconque a passé Access, c'est-à-dire par
       * n'importe quel proche, sans confirmation ni retour en arrière, et
       * depuis qu'il n'y a plus d'export, sans copie de secours non plus.
       * Effacer l'arbre passe désormais par le tableau de bord Cloudflare, où
       * il faut le vouloir.
       */
      return json({ error: 'Méthode non gérée.' }, 405);
    }

    // Tout le reste : le site statique construit par `npm run build`.
    return env.ASSETS.fetch(request);
  },
};
