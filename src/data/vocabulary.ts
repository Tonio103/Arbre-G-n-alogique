/**
 * Vocabulaire d'époque utilisé pour peupler les branches collatérales.
 * Purement fictif : prénoms, métiers et lieux sont choisis pour rester
 * plausibles par période, sans désigner de personnes réelles.
 */

export interface Era {
  /** Borne haute d'année de naissance couverte par cette liste. */
  until: number;
  male: string[];
  female: string[];
}

export const GIVEN_NAMES: Era[] = [
  {
    until: 1885,
    male: [
      'Jean', 'Pierre', 'Louis', 'Jules', 'Émile', 'Auguste', 'Henri', 'Eugène',
      'Alphonse', 'Gustave', 'Léon', 'Victor', 'Ernest', 'Antoine', 'Théodore',
      'Adrien', 'Casimir', 'Firmin', 'Prosper', 'Séraphin',
    ],
    female: [
      'Marie', 'Jeanne', 'Louise', 'Marguerite', 'Augustine', 'Eugénie',
      'Célestine', 'Adèle', 'Berthe', 'Blanche', 'Léonie', 'Hortense',
      'Joséphine', 'Clémence', 'Victorine', 'Philomène', 'Rosalie', 'Aimée',
    ],
  },
  {
    until: 1920,
    male: [
      'Marcel', 'René', 'Robert', 'Maurice', 'André', 'Georges', 'Paul',
      'Lucien', 'Raymond', 'Fernand', 'Gaston', 'Albert', 'Camille', 'Julien',
      'Émilien', 'Roger', 'Marius', 'Aimé',
    ],
    female: [
      'Germaine', 'Suzanne', 'Yvonne', 'Madeleine', 'Simone', 'Renée',
      'Odette', 'Hélène', 'Andrée', 'Lucienne', 'Gabrielle', 'Alice',
      'Denise', 'Paulette', 'Fernande', 'Juliette',
    ],
  },
  {
    until: 1955,
    male: [
      'Jean-Pierre', 'Michel', 'Bernard', 'Claude', 'Daniel', 'Alain',
      'Gérard', 'Christian', 'Guy', 'Jacques', 'Serge', 'Yves', 'Francis',
      'Jean-Claude', 'Raymond', 'Gilbert',
    ],
    female: [
      'Monique', 'Nicole', 'Françoise', 'Jacqueline', 'Danielle', 'Michèle',
      'Colette', 'Annie', 'Éliane', 'Christiane', 'Josette', 'Ginette',
      'Marie-Thérèse', 'Huguette', 'Chantal',
    ],
  },
  {
    until: 1985,
    male: [
      'Philippe', 'Pascal', 'Thierry', 'Laurent', 'Olivier', 'Éric',
      'Frédéric', 'Stéphane', 'Christophe', 'Bruno', 'Patrick', 'Vincent',
      'Franck', 'Hervé', 'Didier', 'Nicolas',
    ],
    female: [
      'Sylvie', 'Isabelle', 'Nathalie', 'Corinne', 'Véronique', 'Sandrine',
      'Valérie', 'Karine', 'Delphine', 'Céline', 'Sophie', 'Laurence',
      'Catherine', 'Muriel', 'Anne-Marie',
    ],
  },
  {
    until: 2006,
    male: [
      'Thomas', 'Nicolas', 'Julien', 'Maxime', 'Alexandre', 'Antoine', 'Hugo',
      'Quentin', 'Romain', 'Baptiste', 'Clément', 'Théo', 'Florian', 'Kévin',
      'Guillaume', 'Mathieu',
    ],
    female: [
      'Camille', 'Manon', 'Léa', 'Chloé', 'Emma', 'Sarah', 'Marine',
      'Justine', 'Pauline', 'Clara', 'Lucie', 'Mathilde', 'Océane', 'Anaïs',
      'Charlotte', 'Élodie',
    ],
  },
  {
    until: 2030,
    male: [
      'Gabriel', 'Raphaël', 'Léo', 'Louis', 'Jules', 'Adam', 'Arthur',
      'Nathan', 'Ethan', 'Noah', 'Sacha', 'Marius', 'Tiago', 'Naël', 'Aaron',
    ],
    female: [
      'Jade', 'Louise', 'Alice', 'Rose', 'Ambre', 'Anna', 'Mia', 'Julia',
      'Nina', 'Lina', 'Iris', 'Zoé', 'Léonie', 'Agathe', 'Romy',
    ],
  },
];

export const SURNAMES = [
  'Delaunay', 'Marchand', 'Vasseur', 'Lemoine', 'Chevalier', 'Roussel',
  'Fontaine', 'Perrin', 'Guillot', 'Bertin', 'Lacroix', 'Berger', 'Rivière',
  'Cordier', 'Aubry', 'Maillard', 'Barbier', 'Renaud', 'Charpentier',
  'Gauthier', 'Colin', 'Leclerc', 'Meunier', 'Boucher', 'Dumont', 'Faure',
  'Girard', 'Bonnet', 'Mercier', 'Blanchard', 'Poirier', 'Lefèvre',
  'Sauvage', 'Duval', 'Loiseau', 'Pasquier', 'Vallet', 'Thibault', 'Noël',
  'Hamon', 'Guérin', 'Robin', 'Baron', 'Prévost', 'Rey', 'Gaillard',
  'Delmas', 'Perrot', 'Estève', 'Granier', 'Reynaud', 'Bastide', 'Amiel',
  'Carbonnel', 'Sabatier', 'Vidal', 'Teissier', 'Roque', 'Malaval', 'Ollier',
];

export interface Region {
  name: string;
  places: string[];
}

export const REGIONS: Record<string, Region> = {
  provence: {
    name: 'Vaucluse',
    places: [
      'Fontaine-de-Vaucluse', 'L’Isle-sur-la-Sorgue', 'Carpentras', 'Apt',
      'Avignon', 'Pernes-les-Fontaines', 'Gordes', 'Cavaillon', 'Sault',
      'Le Thor', 'Velleron', 'Saumane-de-Vaucluse',
    ],
  },
  bourgogne: {
    name: 'Côte-d’Or',
    places: [
      'Beaune', 'Nuits-Saint-Georges', 'Meursault', 'Dijon', 'Chagny',
      'Savigny-lès-Beaune', 'Pommard', 'Aloxe-Corton', 'Gevrey-Chambertin',
      'Santenay',
    ],
  },
  bretagne: {
    name: 'Finistère',
    places: [
      'Quimper', 'Concarneau', 'Douarnenez', 'Pont-l’Abbé', 'Locronan',
      'Audierne', 'Bénodet', 'Plogastel-Saint-Germain',
    ],
  },
  nord: {
    name: 'Nord',
    places: [
      'Lille', 'Roubaix', 'Armentières', 'Douai', 'Valenciennes',
      'Tourcoing', 'Bailleul', 'Seclin',
    ],
  },
  paris: {
    name: 'Île-de-France',
    places: [
      'Paris 11e', 'Paris 14e', 'Paris 20e', 'Vincennes', 'Montreuil',
      'Saint-Mandé', 'Ivry-sur-Seine', 'Asnières-sur-Seine', 'Sceaux',
      'Nogent-sur-Marne',
    ],
  },
  lyon: {
    name: 'Rhône',
    places: [
      'Lyon 4e', 'Lyon 7e', 'Villeurbanne', 'Oullins', 'Tassin-la-Demi-Lune',
      'Caluire-et-Cuire', 'Vienne',
    ],
  },
};


export interface ProfessionEra {
  until: number;
  male: string[];
  female: string[];
}

export const PROFESSIONS: ProfessionEra[] = [
  {
    until: 1900,
    male: [
      'Meunier', 'Forgeron', 'Charron', 'Sabotier', 'Maréchal-ferrant',
      'Tonnelier', 'Cultivateur', 'Tisserand', 'Aubergiste', 'Marchand de toile',
      'Carrier', 'Berger', 'Vigneron', 'Charpentier',
    ],
    female: [
      'Couturière', 'Lingère', 'Sage-femme', 'Institutrice', 'Fileuse',
      'Blanchisseuse', 'Marchande au marché', 'Dentellière', 'Cultivatrice',
    ],
  },
  {
    until: 1945,
    male: [
      'Cheminot', 'Instituteur', 'Mécanicien', 'Comptable', 'Postier',
      'Mineur', 'Boulanger', 'Typographe', 'Ajusteur', 'Employé de mairie',
      'Chef de gare', 'Menuisier',
    ],
    female: [
      'Institutrice', 'Infirmière', 'Employée des PTT', 'Couturière',
      'Modiste', 'Secrétaire', 'Aide-soignante', 'Commerçante',
    ],
  },
  {
    until: 1985,
    male: [
      'Ingénieur', 'Professeur de mathématiques', 'Technicien', 'Architecte',
      'Pharmacien', 'Agent immobilier', 'Kinésithérapeute', 'Chef d’atelier',
      'Contrôleur SNCF', 'Expert-comptable', 'Vétérinaire', 'Ébéniste',
    ],
    female: [
      'Professeure d’histoire', 'Secrétaire de direction', 'Pharmacienne',
      'Orthophoniste', 'Documentaliste', 'Puéricultrice', 'Libraire',
      'Assistante sociale', 'Kinésithérapeute', 'Chercheuse en biologie',
    ],
  },
  {
    until: 2030,
    male: [
      'Développeur', 'Œnologue', 'Ostéopathe', 'Chef de projet', 'Ébéniste',
      'Ingénieur agronome', 'Photographe', 'Data analyste', 'Urbaniste',
      'Professeur des écoles', 'Chef cuisinier', 'Charpentier-couvreur',
    ],
    female: [
      'Développeuse', 'Graphiste', 'Sage-femme', 'Vétérinaire', 'Œnologue',
      'Ingénieure en environnement', 'Journaliste', 'Ostéopathe',
      'Cheffe de projet', 'Architecte d’intérieur', 'Restauratrice d’art',
    ],
  },
];

export const INTERESTS = [
  'Jardinage', 'Pêche à la mouche', 'Accordéon', 'Mots croisés', 'Philatélie',
  'Botanique', 'Randonnée', 'Cuisine provençale', 'Chorale', 'Apiculture',
  'Moto ancienne', 'Aquarelle', 'Échecs', 'Astronomie', 'Généalogie',
  'Poterie', 'Cyclisme', 'Cinéma italien', 'Ornithologie', 'Tango',
  'Course à pied', 'Piano', 'Jeu de boules', 'Menuiserie', 'Voile',
  'Photographie argentique', 'Lecture historique', 'Rugby', 'Escalade',
  'Couture', 'Vin nature', 'Mycologie', 'Bricolage', 'Théâtre amateur',
];

export const ANECDOTES = [
  'Ne partait jamais en voyage sans son carnet de notes.',
  'Faisait le meilleur gratin de la famille, recette jamais écrite.',
  'A appris à conduire à plus de la moitié de ses cousins.',
  'Gardait toutes les cartes postales reçues depuis l’enfance.',
  'Sifflait toujours le même air en travaillant.',
  'A traversé la France à vélo à dix-neuf ans.',
  'Refusait catégoriquement de se faire photographier de face.',
  'Connaissait le nom de chaque arbre du chemin communal.',
  'A gagné trois fois de suite le concours de boules du village.',
  'Écrivait à ses petits-enfants une lettre par mois.',
  'Avait un potager si grand qu’il nourrissait deux familles.',
  'Racontait la même histoire de guerre avec une fin différente à chaque fois.',
  'A tenu le café du village pendant vingt-deux ans.',
  'Chantait faux avec beaucoup de conviction.',
  'A construit de ses mains la table où mange encore la famille.',
  'Notait la météo dans un cahier, tous les jours, pendant quarante ans.',
  'Gardait un bocal de bouchons de liège « au cas où ».',
  'Savait retrouver n’importe quel objet perdu dans la maison.',
];

export const MEMORY_FRAGMENTS = [
  'Les étés passés dans la maison de famille, volets mi-clos.',
  'Le bruit de la machine à coudre le dimanche après-midi.',
  'L’odeur du pain grillé le matin, toujours trop cuit.',
  'Les parties de cartes qui finissaient en discussions politiques.',
  'Le voyage en train jusqu’à la mer, une fois par an.',
  'La photo de mariage posée sur le buffet de la salle à manger.',
  'Les repas de Noël à rallonge, table poussée contre le mur.',
];

export const EDUCATION = [
  'Certificat d’études primaires',
  'École normale d’instituteurs',
  'Brevet élémentaire',
  'Apprentissage en atelier',
  'Baccalauréat, série scientifique',
  'École d’ingénieurs de Grenoble',
  'Faculté de lettres de Lyon',
  'BTS en gestion',
  'École des Beaux-Arts',
  'Formation en alternance',
];

export function pickEra<T extends { until: number }>(eras: T[], year: number): T {
  for (const era of eras) {
    if (year <= era.until) return era;
  }
  return eras[eras.length - 1];
}
