/* happy-dom has no Web Animations API. Components that animate through it
   (Scritto in the Store's title) only need it to exist in unit tests: every
   animation finishes at once and does nothing. Real Chromium is untouched,
   since the stubs are installed only where the API is missing. */
if (typeof Element !== 'undefined' && typeof Element.prototype.animate !== 'function') {
  class TestAnimation {
    id = '';
    effect = null;
    playState: AnimationPlayState = 'finished';
    onfinish: ((this: TestAnimation, event: Event) => unknown) | null = null;
    finished = Promise.resolve(this);
    cancel(): void {}
    finish(): void {}
    play(): void {}
    pause(): void {}
    commitStyles(): void {}
    persist(): void {}
  }
  const scope = globalThis as unknown as { Animation?: unknown };
  scope.Animation ??= TestAnimation;
  Element.prototype.animate = function animate() { return new TestAnimation() as unknown as Animation; };
  Element.prototype.getAnimations = function getAnimations() { return []; };
}
