import { lazy } from "react";

/**
 * Home's code-split overlays.
 *
 * Home itself is the cold-start screen and stays statically imported — but these three are
 * full-screen panels that only exist after a deliberate tap (the avatar menu, re-opening a past Rot
 * Report, revealing a settled standing). Statically importing them dragged the profile menu + its
 * identity editor (~48 KB) and the results/report cards (~38 KB) into the first bytes every player
 * downloads, to render nothing on the first frame.
 *
 * `ProfileMenu` pulls `IdentityEditor` and `ChangeUsernameSheet` with it, which is most of the win.
 *
 * See `app/lazyScreens.ts` for the same treatment at the screen level; `HOME_OVERLAY_LOADERS` is
 * re-exported there so these warm on idle alongside the screens and a tap never waits.
 */

const loadProfileMenu = () => import("@/screens/home/ProfileMenu");
const loadRotReportReplay = () => import("@/screens/results/RotReportReplay");
const loadRoyaleResultsModal = () => import("@/screens/results/RoyaleResultsModal");

export const ProfileMenu = lazy(() => loadProfileMenu().then((m) => ({ default: m.ProfileMenu })));
export const RotReportReplay = lazy(() =>
  loadRotReportReplay().then((m) => ({ default: m.RotReportReplay })),
);
export const RoyaleResultsModal = lazy(() =>
  loadRoyaleResultsModal().then((m) => ({ default: m.RoyaleResultsModal })),
);

export const HOME_OVERLAY_LOADERS = [
  loadRoyaleResultsModal, // the post-run reveal — the moment a player is most likely to reach next
  loadProfileMenu,
  loadRotReportReplay,
];
