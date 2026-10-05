
# Pipeline application runtime

The R9 runtime converts the R7 domain into transaction-bound commands. Every mutation requires:

1. trusted tenant and actor context;
2. action permission;
3. stable idempotency key;
4. canonical payload hash;
5. one repository transaction for mutation, audit and receipt;
6. optimistic version checks;
7. tenant-scoped selectors and ownership fields.

A Prisma adapter is included, but live PostgreSQL validation remains mandatory before rollout. Stage removal is denied while assignments still reference the stage. Terminal-deal reopening requires a separate permission.
