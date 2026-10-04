import React from "react";
import { TransitionSeries, springTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { FPS, SCENES, TRANSITION_S } from "./content";
import { Hook, Vanilla, Governed, Close } from "./scenes";

const f = (s: number) => Math.round(s * FPS);
const T = () => springTiming({ config: { damping: 200 }, durationInFrames: f(TRANSITION_S) });

const SEQ = [
  { key: "hook", s: SCENES.hook, C: Hook },
  { key: "vanilla", s: SCENES.vanilla, C: Vanilla },
  { key: "governed", s: SCENES.governed, C: Governed },
  { key: "close", s: SCENES.close, C: Close },
];

export const TOTAL_FRAMES = SEQ.reduce((n, s) => n + f(s.s), 0) - (SEQ.length - 1) * f(TRANSITION_S);

export const SpineDotsVideo: React.FC = () => (
  <TransitionSeries>
    {SEQ.flatMap(({ key, s, C }, i) => [
      ...(i > 0 ? [<TransitionSeries.Transition key={`t-${key}`} presentation={fade()} timing={T()} />] : []),
      <TransitionSeries.Sequence key={key} durationInFrames={f(s)}>
        <C />
      </TransitionSeries.Sequence>,
    ])}
  </TransitionSeries>
);
