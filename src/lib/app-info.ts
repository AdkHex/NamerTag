/**
 * Single source of truth for the app's display name.
 *
 * The name previously drifted — the window bar said "RsKv" while the bundle said
 * "NamerTag" — because each surface hardcoded its own string. Import these instead.
 *
 * `APP_NAME` is the product; `APP_ATTRIBUTION` is rendered alongside it in smaller type
 * (see TitleBar), so the two are kept separate rather than baked into one string.
 */
export const APP_NAME = 'NameTagger'
export const APP_ATTRIBUTION = 'by Ionicboy'

/** Flat form for plain-text contexts (dialogs, window title) that cannot style a run. */
export const APP_FULL_NAME = `${APP_NAME} ${APP_ATTRIBUTION}`
