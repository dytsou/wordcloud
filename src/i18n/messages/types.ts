import type { EN_MESSAGES } from "./en";

export type TranslationKey = keyof typeof EN_MESSAGES;
export type ShapeTranslationKey =
  | "shapeGalleryLabel"
  | "shapeCategoryNavigation"
  | "shapeCategoryBasic"
  | "shapeCategorySymbols"
  | "shapeCategoryNature"
  | "shapeCategoryAnimals"
  | "shapeCategoryEveryday"
  | "shapeNameCircle"
  | "shapeNameEllipse"
  | "shapeNameSquare"
  | "shapeNameRectangle"
  | "shapeNameTriangle"
  | "shapeNameDiamond"
  | "shapeNameHexagon"
  | "shapeNameStar"
  | "shapeNameHeart"
  | "shapeNameSpeechBubble"
  | "shapeNameCrescentMoon"
  | "shapeNameLightningBolt"
  | "shapeNameMusicNote"
  | "shapeNameSmilingFace"
  | "shapeNameCloud"
  | "shapeNameSun"
  | "shapeNameFlower"
  | "shapeNameLeaf"
  | "shapeNameMountain"
  | "shapeNameWave"
  | "shapeNameCat"
  | "shapeNameDog"
  | "shapeNameBird"
  | "shapeNameFish"
  | "shapeNameButterfly"
  | "shapeNameHouse"
  | "shapeNameBook"
  | "shapeNameLightBulb"
  | "shapeNameTrophy"
  | "shapeNameGameController"
  | "shapeNoShape"
  | "shapeLockRatio"
  | "shapeSize"
  | "shapeWidth"
  | "shapeHeight"
  | "shapeReset"
  | "shapeOneWordNoFit"
  | "shapeNoWordsFit"
  | "shapeAdjustSize"
  | "shapeRemoveMask";

export type MessageMap = Partial<Record<TranslationKey, string>> &
  Record<ShapeTranslationKey, string>;
export type Translate = (
  key: TranslationKey,
  variables?: Record<string, string | number>,
) => string;
