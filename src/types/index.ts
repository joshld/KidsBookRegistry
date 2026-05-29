export interface Profile {
  id: string;
  email: string;
}

export interface Child {
  id: string;
  profileId: string;
  name: string;
}

export type BookStatus = 'Available' | 'Claimed';
export type ListType = 'owned' | 'wishlist';

export interface Book {
  id: string;
  childId: string;
  isbn: string;
  title: string;
  author: string;
  imageUrl: string;
  listType: ListType;
  /** Wishlist only: whether a relative has claimed this book */
  status: BookStatus;
  claimedBy?: string;
}

export interface AppState {
  profile: Profile | null;
  children: Child[];
  books: Book[];
}

export type Action =
  | { type: 'SET_PROFILE'; profile: Profile }
  | { type: 'ADD_CHILD'; child: Child }
  | { type: 'ADD_BOOK'; book: Book }
  | { type: 'CLAIM_BOOK'; bookId: string; claimedBy: string }
  | { type: 'UNCLAIM_BOOK'; bookId: string }
  | { type: 'REMOVE_BOOK'; bookId: string };
