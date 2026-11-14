// Additive account security upgrade:
// - Adds opt-in `mfa_enabled` bool field on `fuloos_users` (defaults to false so existing users are not forced into MFA).
// - Configures Email OTP and conditional MFA (`mfa_enabled = true`) on `fuloos_users`.
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("fuloos_users");
    if (!users.fields.getByName("mfa_enabled")) {
      const fieldDef = { name: "mfa_enabled", type: "bool" };
      users.fields.add(
        typeof BoolField === "function"
          ? new BoolField(fieldDef)
          : typeof Field === "function"
            ? new Field(fieldDef)
            : fieldDef,
      );
    }
    users.otp = {
      ...(users.otp || {}),
      enabled: true,
      duration: 180,
      length: 8,
    };
    users.mfa = {
      ...(users.mfa || {}),
      enabled: true,
      duration: 1800,
      rule: "mfa_enabled = true",
    };
    app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId("fuloos_users");
    users.mfa = {
      ...(users.mfa || {}),
      enabled: false,
      rule: "",
    };
    users.otp = {
      ...(users.otp || {}),
      enabled: false,
    };
    users.fields.removeByName("mfa_enabled");
    app.save(users);
  },
);
