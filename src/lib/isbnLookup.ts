import type { BookMeta } from './mockLookup';

// Open Library Books API — free, no key required
// Docs: https://openlibrary.org/dev/docs/api
export async function lookupIsbn(isbn: string): Promise<BookMeta> {
  const normalized = isbn.replace(/[-\s]/g, '');
  const key = `ISBN:${normalized}`;
  const url = `https://openlibrary.org/api/books?bibkeys=${key}&format=json&jscmd=data`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  const book = data[key];

  if (!book) {
    return { title: '', author: '', imageUrl: '' };
  }

  const title: string = book.title ?? '';

  const author: string =
    Array.isArray(book.authors) && book.authors.length > 0
      ? book.authors.map((a: { name: string }) => a.name).join(', ')
      : '';

  // Prefer the medium cover; fall back to openlibrary cover by ISBN
  const imageUrl: string =
    book.cover?.medium ??
    book.cover?.large ??
    book.cover?.small ??
    `https://covers.openlibrary.org/b/isbn/${normalized}-M.jpg`;

  return { title, author, imageUrl };
}
