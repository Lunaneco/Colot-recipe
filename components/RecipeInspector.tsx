"use client";

import {
  ChevronDown,
  Droplets,
  FlaskConical,
  Heart,
  Pipette,
  X,
} from "lucide-react";
import type { SpatialPaintSample } from "../lib/spatialMix";
import type { MixedColorSnapshot, RecipeUnits } from "../lib/types";
import { MATERIAL_LABELS, PIGMENT_IDS } from "../lib/types";

type RecipeInspectorProps = {
  recipe: RecipeUnits;
  mixed: MixedColorSnapshot;
  sampled?: SpatialPaintSample;
  sampling?: boolean;
  detailed: boolean;
  onToggleDetailed: () => void;
  onClearSample?: () => void;
  onRegister: () => void;
};

export function RecipeInspector({
  recipe,
  mixed,
  sampled,
  sampling = false,
  detailed,
  onToggleDetailed,
  onClearSample,
  onRegister,
}: RecipeInspectorProps) {
  const displayRecipe = sampled?.recipe ?? recipe;
  const displayMixed = sampled?.mixed ?? mixed;
  const pigmentTotal = sampled
    ? PIGMENT_IDS.reduce((sum, key) => sum + sampled.weights[key], 0)
    : PIGMENT_IDS.reduce((sum, key) => sum + recipe[key], 0);
  const waterAmount = sampled?.weights.water ?? recipe.water;
  const overallTotal = pigmentTotal + waterAmount;
  const hasPigment = pigmentTotal > 0.0001;
  const hasMaterial = overallTotal > 0.0001;
  const displayWaterRatio = sampled?.waterRatio ?? mixed.waterRatio;
  const activePigments = PIGMENT_IDS.filter((key) =>
    sampled ? sampled.weights[key] > 0.0001 : recipe[key] > 0,
  );

  return (
    <section
      className={`recipe-card ${sampling ? "is-sampling" : ""} ${sampled ? "is-sampled" : ""}`}
      aria-labelledby="recipe-heading"
      data-rendered-hex={sampled && hasPigment ? displayMixed.hex.toUpperCase() : undefined}
      data-rendered-opacity={sampled && hasPigment ? displayMixed.opacity : undefined}
    >
      <div className="recipe-card__heading">
        <div>
          <p className="eyebrow">
            {sampled ? (
              <Pipette size={14} aria-hidden="true" />
            ) : (
              <FlaskConical size={14} aria-hidden="true" />
            )}
            {sampled ? "スポイト地点のレシピ" : "いまのレシピ"}
          </p>
          <h2 id="recipe-heading" data-testid="color-name">
            {hasPigment
              ? displayMixed.name
              : waterAmount > 0
                ? "透明な水"
                : sampled
                  ? "ここには絵の具がありません"
                  : "まだ色がありません"}
          </h2>
        </div>
        <div
          className={`recipe-color-chip ${sampled ? "is-captured" : ""}`}
          style={{
            "--recipe-color": hasPigment
              ? displayMixed.hex
              : waterAmount > 0
                ? "#d8eef1"
                : "#eee8dc",
            opacity: hasPigment
              ? sampled
                ? displayMixed.opacity
                : Math.max(0.45, displayMixed.opacity)
              : 1,
          } as React.CSSProperties}
          aria-label={
            hasPigment
              ? `${displayMixed.name} ${displayMixed.hex}`
              : waterAmount > 0
                ? "透明な水"
                : "空のパレット"
          }
        />
      </div>

      <div
        className="recipe-sample-actions"
        role="group"
        aria-label={sampled ? "スポイト地点の操作" : "現在の色の操作"}
      >
        <button
          className="sample-register-button"
          type="button"
          onClick={onRegister}
          disabled={!hasPigment}
          aria-label={sampled ? "スポイト地点の色を登録" : "この色を登録"}
          data-testid="open-save-color"
        >
          <Heart
            size={15}
            fill={hasPigment ? "currentColor" : "none"}
            aria-hidden="true"
          />
          この色を登録
        </button>
        {sampled && (
          <button
            className="sample-return-button"
            type="button"
            onClick={onClearSample}
            aria-label="スポイト結果を閉じて全体レシピへ戻る"
          >
            <X size={14} aria-hidden="true" />
            全体へ戻る
          </button>
        )}
      </div>

      {!hasMaterial ? (
        <div className="recipe-empty">
          <span className="recipe-empty__drop" aria-hidden="true" />
          <p>
            下の絵の具を選んで
            <br />
            紙の上に置いてみましょう
          </p>
        </div>
      ) : (
        <>
          <div className="recipe-bars" data-testid="recipe-summary">
            {activePigments.map((key) => {
              const localAmount = sampled?.weights[key] ?? recipe[key];
              const share = sampled
                ? sampled.pigmentRatio[key] * 100
                : pigmentTotal
                  ? (recipe[key] / pigmentTotal) * 100
                  : 0;
              return (
                <div className="recipe-row" key={key}>
                  <div className="recipe-row__label">
                    <span>{MATERIAL_LABELS[key]}</span>
                    <strong data-testid={`recipe-${key}`}>
                      {sampled ? localAmount.toFixed(2) : displayRecipe[key]}
                    </strong>
                    <span className="unit-label">
                      {sampled ? "局所量" : "単位"}
                    </span>
                  </div>
                  <div className="ratio-track" aria-hidden="true">
                    <span
                      className={`ratio-track__fill ratio-track__fill--${key}`}
                      style={{ width: `${share}%` }}
                    />
                  </div>
                  <span className="ratio-value">{share.toFixed(1)}%</span>
                </div>
              );
            })}
            {waterAmount > 0 && (
              <div className="recipe-row recipe-row--water">
                <div className="recipe-row__label">
                  <span>水</span>
                  <strong data-testid="recipe-water">
                    {sampled ? waterAmount.toFixed(2) : displayRecipe.water}
                  </strong>
                  <span className="unit-label">
                    {sampled ? "局所量" : "単位"}
                  </span>
                </div>
                <div className="ratio-track" aria-hidden="true">
                  <span
                    className="ratio-track__fill ratio-track__fill--water"
                    style={{
                      width: `${overallTotal ? (waterAmount / overallTotal) * 100 : 0}%`,
                    }}
                  />
                </div>
                <span className="ratio-value">
                  {overallTotal
                    ? ((waterAmount / overallTotal) * 100).toFixed(1)
                    : "0.0"}
                  %
                </span>
              </div>
            )}
          </div>

          <div className="pigment-ratio">
            <span>{sampled ? "この場所の顔料比率" : "顔料比率"}</span>
            <strong>
              {hasPigment
                ? activePigments
                    .map((key) =>
                      sampled
                        ? `${MATERIAL_LABELS[key]} ${(sampled.pigmentRatio[key] * 100).toFixed(1)}%`
                        : `${MATERIAL_LABELS[key]} ${recipe[key]}`,
                    )
                    .join("：")
                : "顔料なし"}
            </strong>
            {waterAmount > 0 && (
              <em className="mobile-water-ratio">
                水 {Math.round(displayWaterRatio * 100)}%
              </em>
            )}
          </div>

          {detailed && (
            <div className="recipe-details" aria-label="詳しい色情報">
              <dl>
                <div>
                  <dt>HEX</dt>
                  <dd data-testid="recipe-hex">
                    {displayMixed.hex.toUpperCase()}
                  </dd>
                </div>
                <div>
                  <dt>RGB</dt>
                  <dd>
                    {displayMixed.rgb.r}, {displayMixed.rgb.g},{" "}
                    {displayMixed.rgb.b}
                  </dd>
                </div>
                <div>
                  <dt>HSL</dt>
                  <dd>
                    {Math.round(displayMixed.hsl.h)}°,{" "}
                    {Math.round(displayMixed.hsl.s)}%,{" "}
                    {Math.round(displayMixed.hsl.l)}%
                  </dd>
                </div>
                <div>
                  <dt>透明度</dt>
                  <dd>{Math.round((1 - displayMixed.opacity) * 100)}%</dd>
                </div>
                <div>
                  <dt>濃さ</dt>
                  <dd>{Math.round(displayMixed.intensity * 100)}%</dd>
                </div>
                <div>
                  <dt>のび</dt>
                  <dd>{Math.round(displayMixed.spread * 100)}%</dd>
                </div>
              </dl>
              <div className="water-meter">
                <Droplets size={15} aria-hidden="true" />
                <span>水分量</span>
                <div className="water-meter__track" aria-hidden="true">
                  <span style={{ width: `${displayWaterRatio * 100}%` }} />
                </div>
                <strong>{Math.round(displayWaterRatio * 100)}%</strong>
              </div>
            </div>
          )}
        </>
      )}

      <button
        className="text-toggle"
        type="button"
        onClick={onToggleDetailed}
        aria-expanded={detailed}
      >
        {detailed ? "かんたん表示" : "くわしい数値を見る"}
        <ChevronDown
          size={16}
          className={detailed ? "is-rotated" : ""}
          aria-hidden="true"
        />
      </button>
    </section>
  );
}
