export interface BookMeta {
  title: string;
  author: string;
  imageUrl: string;
}

const ISBN_MAP: Record<string, BookMeta> = {
  '9780399226908': {
    title: 'The Very Hungry Caterpillar',
    author: 'Eric Carle',
    imageUrl: 'https://covers.openlibrary.org/b/isbn/9780399226908-M.jpg',
  },
  '9780062316578': {
    title: 'The Gruffalo',
    author: 'Julia Donaldson',
    imageUrl: 'https://covers.openlibrary.org/b/isbn/9780062316578-M.jpg',
  },
  '9780060254926': {
    title: 'Where the Wild Things Are',
    author: 'Maurice Sendak',
    imageUrl: 'https://covers.openlibrary.org/b/isbn/9780060254926-M.jpg',
  },
  '9780679888406': {
    title: 'Green Eggs and Ham',
    author: 'Dr. Seuss',
    imageUrl: 'https://covers.openlibrary.org/b/isbn/9780679888406-M.jpg',
  },
  '9780439023481': {
    title: 'The Hunger Games',
    author: 'Suzanne Collins',
    imageUrl: 'https://covers.openlibrary.org/b/isbn/9780439023481-M.jpg',
  },
};

const FALLBACK: BookMeta = {
  title: 'Unknown Book',
  author: 'Unknown Author',
  imageUrl: '',
};

export function mockLookup(isbn: string): BookMeta {
  const normalized = isbn.replace(/[-\s]/g, '');
  return ISBN_MAP[normalized] ?? FALLBACK;
}
