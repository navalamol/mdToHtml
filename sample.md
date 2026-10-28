# Welcome to md2html

A quick demo of the converter with common Markdown elements.

## Code Example

```javascript
function greet(name) {
  return `Hello, ${name}!`;
}
console.log(greet("world"));
```

```python
def factorial(n):
    return 1 if n <= 1 else n * factorial(n - 1)
```

## Table

| Feature       | Status | Notes           |
|---------------|--------|-----------------|
| Syntax hilite | ✓      | 190+ languages  |
| Dark theme    | ✓      | `--theme dark`  |
| TOC sidebar   | ✓      | Auto-generated  |
| Copy button   | ✓      | One-click copy  |

## Blockquote

> "Any sufficiently advanced technology is indistinguishable from magic."
> — Arthur C. Clarke

## Lists

- Responsive layout
- Auto table of contents
- Sticky TOC on wide screens
- Active section highlighting

### Numbered

1. Run `node md2html.js file.md`
2. Open the output HTML
3. Done!

## Inline Styles

Supports **bold**, *italic*, `inline code`, and [links](https://example.com).
