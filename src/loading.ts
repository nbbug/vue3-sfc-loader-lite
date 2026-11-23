/**
 * A module that is currently loading. It is stored in `moduleCache` so that
 * concurrent requests for the same module share one promise.
 *
 * @internal
 */
export class Loading {
  constructor(public promise: Promise<any>) {}
}
