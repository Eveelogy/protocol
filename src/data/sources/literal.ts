// Reads data literals out of other sites' JavaScript WITHOUT executing it.
// We parse to an AST and only evaluate plain literal nodes; anything else becomes undefined.
import { type Node, parse } from 'acorn'
import { full } from 'acorn-walk'

type Any = any // AST nodes from acorn are loosely typed

export function parseJs(code: string): Node {
  return parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true })
}

/** Top-level `const/var/let name = <expr>` declarations, for resolving `lt.COMMON`-style enum references. */
export function topLevelConsts(ast: Node): Map<string, Any> {
  const m = new Map<string, Any>()
  full(ast, (n: Any) => {
    if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier' && n.init) m.set(n.id.name, n.init)
  })
  return m
}

/**
 * Evaluates a literal-only expression. Supported: objects, arrays, strings, numbers, booleans, null,
 * `!0`/`!1`, negative numbers, template strings without `${}`, and `Enum.KEY` member references
 * (resolved through `consts` when possible, else the key name). Everything else → undefined.
 */
export function literal(node: Any, consts?: Map<string, Any>, depth = 0): unknown {
  if (!node || depth > 40) return undefined
  switch (node.type) {
    case 'Literal':
      return node.value
    case 'TemplateLiteral':
      return node.expressions.length ? undefined : node.quasis.map((q: Any) => q.value.cooked).join('')
    case 'UnaryExpression': {
      const v = literal(node.argument, consts, depth + 1)
      if (node.operator === '-' && typeof v === 'number') return -v
      if (node.operator === '!' ) return v === undefined ? undefined : !v
      if (node.operator === 'void') return undefined
      return undefined
    }
    case 'ArrayExpression':
      return node.elements.map((e: Any) => literal(e, consts, depth + 1))
    case 'ObjectExpression': {
      const o: Record<string, unknown> = {}
      for (const p of node.properties) {
        if (p.type !== 'Property' || p.kind !== 'init') continue
        const key = p.computed ? literal(p.key, consts, depth + 1) : p.key.type === 'Identifier' ? p.key.name : p.key.value
        if (typeof key !== 'string' && typeof key !== 'number') continue
        o[String(key)] = literal(p.value, consts, depth + 1)
      }
      return o
    }
    case 'MemberExpression': {
      if (node.computed || node.property.type !== 'Identifier') return undefined
      const key = node.property.name
      if (node.object.type === 'Identifier' && consts?.has(node.object.name)) {
        const target = literal(consts.get(node.object.name), undefined, depth + 1)
        if (target && typeof target === 'object' && key in (target as object)) return (target as Record<string, unknown>)[key]
      }
      return key // enum-style reference: keep the key name (e.g. "COMMON")
    }
    case 'CallExpression':
      // `wrap(data)` → look through to `data` (the call itself is never run). Only single-argument calls.
      return node.arguments.length === 1 ? literal(node.arguments[0], consts, depth + 1) : undefined
    case 'Identifier':
      if (consts?.has(node.name)) {
        const init = consts.get(node.name)
        if (['ObjectExpression', 'ArrayExpression', 'Literal', 'TemplateLiteral'].includes(init.type)) return literal(init, consts, depth + 1)
      }
      return undefined
    default:
      return undefined
  }
}

/** All object literals in the program whose own keys include every key in `keys`. */
export function findObjects(ast: Node, keys: string[], consts?: Map<string, Any>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  full(ast, (n: Any) => {
    if (n.type !== 'ObjectExpression') return
    const names = new Set(n.properties.filter((p: Any) => p.type === 'Property' && !p.computed).map((p: Any) => (p.key.type === 'Identifier' ? p.key.name : p.key.value)))
    if (keys.every((k) => names.has(k))) out.push(literal(n, consts) as Record<string, unknown>)
  })
  return out
}

/** The initializer of a top-level declaration whose literal value satisfies `test`. */
export function findDeclaration(ast: Node, test: (v: unknown) => boolean, consts?: Map<string, Any>): unknown {
  let found: unknown
  full(ast, (n: Any) => {
    if (found !== undefined || n.type !== 'VariableDeclarator' || !n.init) return
    if (n.init.type !== 'ObjectExpression' && n.init.type !== 'ArrayExpression') return
    const v = literal(n.init, consts)
    if (test(v)) found = v
  })
  return found
}
