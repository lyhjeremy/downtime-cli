/**
 * The content layer contract. Trivia is simply the first implementation; word
 * games, breathing prompts and task-themed micro-summaries plug in the same way
 * without the pipeline knowing anything about them.
 *
 * A content module is any object shaped like:
 *
 *   {
 *     id: 'trivia',
 *     title: 'Trivia',
 *     start(ctx)          called once when downtime mode opens
 *     onKey(key)          a single keypress; return true to request a redraw
 *     render(viewport)    returns the frame as a string. viewport is
 *                         { columns, rows, elapsedMs, command, taskFinished }
 *     stop()              called once on the way out; persist anything here
 *     summary()           optional short line for the re-entry recap
 *     canExit()           optional. With exit.mode = finish_round the pipeline
 *                         waits for this to return true before closing.
 *   }
 *
 * ctx provides:
 *   requestRender()   ask for a repaint outside the ticker
 *   requestExit()     ask the pipeline to close downtime mode now
 */

export function createRegistry() {
  const modules = new Map()
  return {
    register(id, factory) {
      modules.set(id, factory)
    },
    has(id) {
      return modules.has(id)
    },
    create(id, options) {
      const factory = modules.get(id)
      if (!factory) throw new Error(`unknown content module: ${id}`)
      return factory(options)
    },
    ids() {
      return [...modules.keys()]
    },
  }
}

export function assertContentModule(mod) {
  for (const method of ['start', 'onKey', 'render', 'stop']) {
    if (typeof mod[method] !== 'function') {
      throw new TypeError(`content module "${mod.id}" is missing ${method}()`)
    }
  }
  return mod
}
