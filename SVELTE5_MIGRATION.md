# Svelte 5 Migration Guide for PodNotes

## Overview
This guide outlines the migration strategy from Svelte 4 patterns to Svelte 5 runes in the PodNotes codebase.

## Migration Status
- ✅ Svelte 5.25.3 installed
- ✅ Build configuration updated
- ✅ Biome linting configured and applied
- 🟡 Components use Svelte 4 patterns (migration pending)

## Key Changes in Svelte 5

### 1. Props: `export let` → `$props()`
```svelte
<!-- Old (Svelte 4) -->
<script lang="ts">
  export let value: string;
  export let disabled = false;
</script>

<!-- New (Svelte 5) -->
<script lang="ts">
  interface Props {
    value: string;
    disabled?: boolean;
  }
  
  let { value, disabled = false }: Props = $props();
</script>
```

### 2. Reactive Statements: `$:` → `$derived`
```svelte
<!-- Old -->
$: doubled = count * 2;

<!-- New -->
let doubled = $derived(count * 2);
```

### 3. State: `let` → `$state`
```svelte
<!-- Old -->
let count = 0;

<!-- New -->
let count = $state(0);
```

### 4. Effects: `onMount`/`onDestroy` → `$effect`
```svelte
<!-- Old -->
onMount(() => {
  const interval = setInterval(() => {...}, 1000);
  return () => clearInterval(interval);
});

<!-- New -->
$effect(() => {
  const interval = setInterval(() => {...}, 1000);
  return () => clearInterval(interval);
});
```

### 5. Store Usage in Components
When using stores with runes, you need to manage subscriptions manually:

```svelte
<!-- Old -->
<script>
  import { myStore } from './stores';
</script>
<div>{$myStore}</div>

<!-- New -->
<script>
  import { myStore } from './stores';
  
  let storeValue = $state();
  
  $effect(() => {
    const unsub = myStore.subscribe(v => storeValue = v);
    return unsub;
  });
</script>
<div>{storeValue}</div>
```

## Migration Strategy

### Phase 1: Infrastructure (✅ Complete)
1. Update to Svelte 5
2. Configure build tools
3. Fix linting issues
4. Ensure backward compatibility

### Phase 2: Gradual Component Migration
1. Add `<svelte:options runes />` to individual components
2. Start with leaf components (no children)
3. Work up to container components
4. Test thoroughly after each migration

### Phase 3: Store Modernization
1. Consider replacing some stores with component state
2. Use context API with runes for shared state
3. Simplify store interfaces

## Component Migration Checklist

For each component:
- [ ] Add `<svelte:options runes />` at the top
- [ ] Convert `export let` props to `$props()`
- [ ] Convert reactive statements to `$derived`
- [ ] Convert state variables to `$state`
- [ ] Replace lifecycle hooks with `$effect`
- [ ] Update store subscriptions
- [ ] Test all functionality
- [ ] Update any parent components if needed

## Example Migration

See the attempted EpisodePlayer migration for a complex example:
1. Props converted to `$props()` pattern
2. State managed with `$state` runes
3. Store subscriptions handled in `$effect`
4. Derived values use `$derived`
5. Cleanup handled in effect returns

## Best Practices

1. **Don't migrate everything at once** - Svelte 5 is backward compatible
2. **Test thoroughly** - Especially store interactions
3. **Use TypeScript** - Better type inference with runes
4. **Simplify when possible** - Runes often require less code
5. **Consider performance** - Fine-grained reactivity can improve performance

## Resources

- [Svelte 5 Documentation](https://svelte.dev/docs/svelte/v5-migration-guide)
- [Runes Overview](https://svelte.dev/docs/svelte/runes)
- [Migration Examples](https://svelte.dev/docs/svelte/v5-migration-guide#examples)