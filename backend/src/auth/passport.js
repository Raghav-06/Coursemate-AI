import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { config } from "../config/index.js";
import { getUser, upsertGoogleUser } from "../db/store.js";

const { google, allowedDomains } = config.auth;

/** Registers the Google OAuth strategy. Users are created/updated in Postgres on each sign-in. */
export function configurePassport() {
  if (google.clientId && google.clientSecret) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: google.clientId,
          clientSecret: google.clientSecret,
          callbackURL: google.callbackUrl,
          scope: ["openid", "profile", "email"],
          state: true, // CSRF protection: the callback must carry the state we issued
        },
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const json = profile._json ?? {};
            const email = json.email ?? profile.emails?.[0]?.value;
            if (!email) return done(null, false, { message: "Your Google account has no email address." });

            const domain = email.split("@")[1]?.toLowerCase();
            if (allowedDomains.length && !allowedDomains.includes(domain)) {
              return done(null, false, { message: `Sign-in is limited to ${allowedDomains.join(", ")} accounts.` });
            }

            const user = await upsertGoogleUser({
              googleId: profile.id,
              email,
              emailVerified: json.email_verified ?? profile.emails?.[0]?.verified,
              name: profile.displayName,
              givenName: profile.name?.givenName,
              familyName: profile.name?.familyName,
              avatarUrl: json.picture ?? profile.photos?.[0]?.value,
              locale: json.locale,
            });
            done(null, user);
          } catch (err) {
            done(err);
          }
        }
      )
    );
  }

  // Only the user id goes into the session; the row is reloaded per request.
  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id, done) => {
    try {
      done(null, (await getUser(id)) ?? false);
    } catch (err) {
      done(err);
    }
  });

  return passport;
}

export const googleConfigured = () => Boolean(google.clientId && google.clientSecret);
