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
 * profite automatiquement, sans code d'authentification à écrire ici.
 */

export interface Env {
  ASSETS: Fetcher;
  FAMILY_KV: KVNamespace;
}

const FAMILY_KEY = 'family';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

/** Vérification minimale : on ne veut pas écraser l'arbre par n'importe
 *  quoi, mais la validation détaillée (dates, doublons…) reste au
 *  chargement côté application, comme pour un import GEDCOM. */
function looksLikeFamilyDataset(value: unknown): value is { people: unknown[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { people?: unknown }).people)
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

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
        await env.FAMILY_KV.put(FAMILY_KEY, JSON.stringify(body));
        return new Response(null, { status: 204 });
      }

      if (request.method === 'DELETE') {
        await env.FAMILY_KV.delete(FAMILY_KEY);
        return new Response(null, { status: 204 });
      }

      return json({ error: 'Méthode non gérée.' }, 405);
    }

    // Tout le reste : le site statique construit par `npm run build`.
    return env.ASSETS.fetch(request);
  },
};
