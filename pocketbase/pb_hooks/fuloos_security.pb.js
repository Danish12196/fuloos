/// <reference path="../pb_data/types.d.ts" />
// Fuloos security hooks for PocketBase (v0.23+ / v0.40+).
// Install this file in the PocketBase server's pb_hooks/ directory.

routerAdd(
  "POST",
  "/api/fuloos/sign-out-everywhere",
  (e) => {
    const auth = e.auth;
    if (!auth || auth.collection().name !== "fuloos_users") {
      return e.unauthorizedError("Authentication required.", null);
    }
    auth.refreshTokenKey();
    $app.save(auth);
    return e.json(200, { ok: true });
  },
  $apis.requireAuth("fuloos_users"),
);
