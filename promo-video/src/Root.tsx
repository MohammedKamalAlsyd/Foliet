import React from "react";
import { Composition } from "remotion";
import {
  FolietPromoVideo,
  PROMO_DURATION_FRAMES,
  PROMO_FPS,
  PROMO_HEIGHT,
  PROMO_WIDTH,
} from "./FolietPromoVideo";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="FolietPromo"
      component={FolietPromoVideo}
      durationInFrames={PROMO_DURATION_FRAMES}
      fps={PROMO_FPS}
      width={PROMO_WIDTH}
      height={PROMO_HEIGHT}
    />
  );
};
