// Setup for the `dom` vitest project.
//
// `localStorage` is not reachable in this environment, from either side:
// jsdom's own Storage isn't exposed on the window vitest builds, and Node 22+
// defines an EXPERIMENTAL `globalThis.localStorage` that is inert without
// `--localstorage-file` (hence the warning it prints). So the tests that cover
// the persistence boundary get a real, spec-shaped Storage installed here.
//
// This stubs the STORE, not the code under test: projectStore's serialize →
// stringify → parse → migrate path runs exactly as it does in a browser.

class MemoryStorage implements Storage {
  private map = new Map<string, string>()

  get length(): number {
    return this.map.size
  }

  clear(): void {
    this.map.clear()
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.map.delete(key)
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value))
  }
}

function install(name: 'localStorage' | 'sessionStorage') {
  const existing = (globalThis as Record<string, unknown>)[name]
  // Only replace an absent or unusable binding — never a working one.
  const usable =
    existing != null &&
    typeof (existing as Partial<Storage>).getItem === 'function'
  if (usable) return
  const storage = new MemoryStorage()
  // Both bindings: code reads the bare global, jsdom-aware code reads window.
  const targets: unknown[] = [globalThis]
  if (globalThis.window !== globalThis) targets.push(globalThis.window)
  for (const target of targets) {
    Object.defineProperty(target as object, name, {
      value: storage,
      configurable: true,
      writable: true,
    })
  }
}

install('localStorage')
install('sessionStorage')
