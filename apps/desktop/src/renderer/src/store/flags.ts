/* Store surfaces that are built but not shown yet. Flip a flag to ship it. */
export const STORE_FLAGS: { readonly collections: boolean } = {
  /** The carousel of collections atop Discover. Off until the Store has enough
   *  listings that collections read as curated rather than sparse. */
  collections: false
};
