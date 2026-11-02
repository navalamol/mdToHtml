---
name: add-design-component
description: Add a component to @syndigo/design-system following the project's CVA + Tailwind CSS 4 + @base-ui/react conventions. Covers shadcn scaffolding, no-barrel imports, OKLch tokens, and the cn() merge pattern.
---

# Add Design System Component

Add a new component to `packages/design-system/` following the project's conventions. The codebase already has 44 components — match their style; this is not a place for stylistic experiments.

## When to use

- Adding a new reusable UI primitive (`@syndigo/design-system/components/<name>`).
- Adding a CVA variant set to an existing or new component.
- Wrapping a `@base-ui/react` primitive with project-styled defaults.

**Do NOT use** for app-level components (page sections, business logic). Those live in `apps/pxc-retail/src/components/` and don't need to follow these rules.

## Stack

- **Primitive layer**: `@base-ui/react` (accessible foundations) — `import { Button as ButtonPrimitive } from '@base-ui/react/button'`
- **Variants**: `class-variance-authority` (`cva`, `VariantProps`)
- **Styles**: Tailwind CSS 4 with `@theme inline` OKLch tokens (defined in `src/styles/globals.css`)
- **Class merging**: `cn()` from `@syndigo/design-system/lib/utils` (`twMerge(clsx(...))`)
- **Icons**: `lucide-react`
- **Scaffold**: shadcn CLI with `base-nova` preset (`components.json`)

## Required inputs (ask if not provided)

1. **Component name** — kebab-case filename, PascalCase export. E.g. `tag-input.tsx` exports `TagInput`.
2. **Base primitive** — `@base-ui/react/<primitive>` if applicable, or `'span'`/`'div'`/etc.
3. **Variants** — does it need CVA variants (color/size)? List them.
4. **Existing pattern** — is there a similar component to mirror? (e.g. mirroring `Button` for an interactive primitive)

## File layout

```
packages/design-system/src/
├── components/<name>.tsx       # the component (single file, no folder)
├── lib/utils.ts                # cn() helper — already exists, import only
├── styles/globals.css          # design tokens — extend here for new tokens
└── hooks/<name>.ts             # only if the component needs a hook
```

One file per component. No `index.ts` barrels — consumers import individually:

```ts
// ✅ Good
import { Button } from '@syndigo/design-system/components/button'

// ❌ Bad
import { Button } from '@syndigo/design-system/components'
```

This is enforced by `package.json` `exports`:

```json
"./components/*": "./src/components/*.tsx"
```

## Try shadcn first

For anything that has a shadcn equivalent under the `base-nova` preset, scaffold it instead of hand-writing:

```bash
cd packages/design-system
npx shadcn@latest add <component-name>
```

The CLI writes to `src/components/<name>.tsx` using the project's `components.json` aliases (`@syndigo/design-system/components`, `@syndigo/design-system/lib/utils`). If it lands and works, you're done — just verify imports and exports.

For project-specific components without a shadcn equivalent, hand-write following the patterns below.

## Pattern A — Primitive wrapper with CVA variants

Use for interactive elements where a `@base-ui/react` primitive does the heavy lifting (accessibility, keyboard, ARIA). Mirror `button.tsx`:

```tsx
import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'

import { cn } from '@syndigo/design-system/lib/utils'

const myVariants = cva(
  'base classes that apply to every variant',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        secondary: 'bg-secondary text-secondary-foreground',
      },
      size: {
        sm: 'h-7 px-2 text-xs',
        default: 'h-8 px-2.5 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function MyComponent({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof myVariants>) {
  return (
    <ButtonPrimitive
      data-slot="my-component"
      className={cn(myVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { MyComponent, myVariants }
```

## Pattern B — Composite component (no primitive, composable subparts)

Use when the component is a layout primitive — like `card.tsx` — with named subcomponents:

```tsx
import * as React from 'react'
import { cn } from '@syndigo/design-system/lib/utils'

function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn('group/card flex flex-col gap-4 rounded-xl bg-card', className)}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn('px-4', className)}
      {...props}
    />
  )
}

export { Card, CardHeader }
```

## Pattern C — Polymorphic via `useRender` (mirrors `badge.tsx`)

Use when the component should be rendered as a different tag based on a `render` prop:

```tsx
import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
// ... + cva, VariantProps, cn

function Badge({ className, variant = 'default', render, ...props }: useRender.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: 'span',
    props: mergeProps<'span'>(
      { className: cn(badgeVariants({ variant }), className) },
      props,
    ),
    render,
    state: { slot: 'badge', variant },
  })
}
```

## Styling rules

- **Always merge with `cn(...)`**. Every component accepts `className` as the last (or named) class merge slot so consumers can override.
- **Use semantic tokens, not raw colors**. `bg-primary` / `text-foreground` / `border-border` — NOT `bg-blue-500`. The tokens are OKLch and switch with dark mode automatically.
- **Data attributes for variants**: `data-slot="<name>"` on the root element. Used by ancestor selectors elsewhere in the system (e.g. `has-data-[slot=card-footer]:pb-0`). Match the convention.
- **Container queries** are encouraged (Tailwind 4 supports them natively): `@container/card-header`.
- **Dark mode** is automatic via the `dark` custom variant in `globals.css` — write classes like `dark:bg-input/30`, no `@media` blocks needed.
- **No inline styles** unless variable-driven; use Tailwind classes.

## Common semantic tokens (defined in `globals.css`)

```
bg-background / text-foreground
bg-card / text-card-foreground
bg-primary / text-primary-foreground
bg-secondary / text-secondary-foreground
bg-muted / text-muted-foreground
bg-accent / text-accent-foreground
bg-destructive / text-destructive (also: text-destructive-foreground)
border-border / border-input / ring-ring
bg-popover / text-popover-foreground
```

Sidebar tokens (`bg-sidebar`, `text-sidebar-foreground`, etc.) and chart tokens (`text-chart-1` … `chart-5`) exist too — use only inside their respective component families.

## Adding a new design token

If a component genuinely needs a new color slot:

1. Add a CSS variable to the `:root` (and `.dark`) blocks of `src/styles/globals.css` — keep it OKLch.
2. Wire it into the `@theme inline` block: `--color-<name>: var(--<name>)`.
3. Use `bg-<name>` / `text-<name>` in your component.

Don't introduce a new token for a one-off color — fall back to existing semantic tokens or pass `className` from the consumer.

## Verify

```bash
pnpm typecheck --filter=@syndigo/design-system
pnpm format
pnpm build --filter=@syndigo/design-system
```

For visual verification, run the consumer app:

```bash
pnpm dev --filter=pxc-retail
```

…and exercise the component in a real page. Hot-reload picks up design-system changes automatically.

## Checklist

- [ ] File at `packages/design-system/src/components/<name>.tsx` (single file, no folder)
- [ ] `cn(...)` used to merge `className` prop
- [ ] `data-slot="<name>"` attribute on the root element
- [ ] CVA used for any 2+ visual variants
- [ ] Imports use the package-qualified paths (`@syndigo/design-system/lib/utils`, `@base-ui/react/<primitive>`)
- [ ] Named exports — no `default export`
- [ ] No barrel file changes (consumer imports `@syndigo/design-system/components/<name>` directly)
- [ ] Semantic tokens used (not raw colors)
- [ ] Dark mode works (`dark:` variants where needed)
- [ ] `pnpm typecheck` + `pnpm format` pass

## Common mistakes

- **Default exports** — every component in this codebase uses `export { Name }`. Don't break the pattern.
- **Barrel files** — never create `components/index.ts`. The package `exports` only resolves `./components/*` to individual files.
- **Raw color classes** (`bg-blue-500`) — they don't theme, don't dark-mode, and signal a missing token discussion.
- **Forgetting `cn(...)`** — string concatenation defeats `tailwind-merge`'s conflict resolution. Consumers can't override your defaults.
- **Importing from `react` for hooks then forgetting `import * as React from 'react'`** — match the existing pattern in each file (some use named, some use namespace).
- **Skipping `data-slot`** — ancestor selectors elsewhere in the system rely on it. Without it, container-query and `has-data-[slot=...]` patterns break silently.
- **Putting app-specific components here** — page sections, business components, anything with oRPC or i18n hooks belongs in `apps/pxc-retail/src/components/`. The design system is presentation only.
- **Hand-writing what shadcn could scaffold** — saves time and stays consistent with the `base-nova` preset.
