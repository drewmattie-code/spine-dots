import React from "react";
import { Composition } from "remotion";
import { FPS, WIDTH, HEIGHT } from "./content";
import { SpineDotsVideo, TOTAL_FRAMES } from "./Video";

export const RemotionRoot: React.FC = () => (
  <Composition
    id="SpineDots"
    component={SpineDotsVideo}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
  />
);
