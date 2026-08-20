/**
 * "Battle Mode" is the product-facing name of this Home card; `DuelCard` is kept as the stable export
 * that Home and the tests import. The implementation lives in ./battle/BattleModeCard, split into
 * small reusable pieces (BattleAvatar, VersusMark, BestOfSevenPips, BattleCTA, PhoneSilhouette).
 */
export { BattleModeCard as DuelCard } from "./battle/BattleModeCard";
