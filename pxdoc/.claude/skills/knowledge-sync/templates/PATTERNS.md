# Repo-wide Patterns

Patterns that hold across more than one knowledge area. An area doc references a pattern here
instead of restating it. Each entry names the pattern, the classes that implement it, and the rule
a contributor must follow to extend it.

## <Pattern name>

**Shape:** `<BaseInterface>` → `<AbstractBase>` → `<ConcreteExample>`
**Where:** `<module>`, `<module>`
**To add one:** the exact steps — which base class to extend, where to register, what wiring or
config entry the new implementation needs.
**Failure if skipped:** the error text a contributor sees when a step is missed.

## Last verified

YYYY-MM-DD | commit `<short sha>` | branch `<branch>`
