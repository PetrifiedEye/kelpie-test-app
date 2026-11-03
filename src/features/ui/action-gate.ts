/** Runs one async action at a time. A second call while the first is in flight is ignored. */
export function createActionGate() {
  let held = false;

  return {
    get busy(): boolean {
      return held;
    },
    async run(work: () => Promise<void>): Promise<boolean> {
      if (held) return false;
      held = true;
      try {
        await work();
        return true;
      } finally {
        held = false;
      }
    },
  };
}
