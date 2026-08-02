import type { PigmentId } from "./types";

/**
 * Two-constant artist-paint calibration profile.
 *
 * K (absorption) and S (scattering) were derived from measured Golden Heavy
 * Body acrylic drawdowns in the RIT Artist Paint Spectral Database. The
 * numerical transcription used here comes from Wacton.Unicolour's
 * MIT-licensed ArtistPaint dataset. The underlying measurements are third
 * party data and are not relicensed by this project; see
 * THIRD_PARTY_NOTICES.md.
 */

export const PAINT_CALIBRATION_WAVELENGTHS_NM = Object.freeze(
  Array.from({ length: 38 }, (_, index) => 380 + index * 10),
);

/** Stable short name retained for callers of the spectral engine. */
export const SPECTRAL_WAVELENGTHS = PAINT_CALIBRATION_WAVELENGTHS_NM;

/**
 * Surface-reflection constants used by Wacton.Unicolour's SPEX rendering
 * assumption. The RIT source measurements were acquired in SPIN mode; SPEX is
 * the selected output geometry in the transcription implementation, not the
 * original measurement condition. The direct k1 reflection term is therefore
 * omitted only when mapping the modelled internal reflectance to this display
 * geometry.
 */
export const SAUNDERSON_K1 = 0.03;
export const SAUNDERSON_K2 = 0.65;

export type PaintCalibrationProfileVersion =
  | "rit-artist-paint-two-constant-2016-v1";

export interface PaintCalibrationMetadata {
  readonly profileVersion: PaintCalibrationProfileVersion;
  readonly model: "Kubelka-Munk two-constant (K and S)";
  readonly opticalAssumption: "opaque, optically infinite paint layer";
  readonly ratioBasis: "relative-parts-of-complete-paint";
  readonly ratioDescription: string;
  readonly paintLine: "Golden Artist Colors Heavy Body acrylic";
  readonly displayColorimetry: {
    readonly illuminant: "CIE standard illuminant D65";
    readonly observer: "CIE 1931 2 degree";
    readonly outputSpace: "sRGB";
    readonly chromaticAdaptation: "none (same D65 viewing illuminant)";
  };
  readonly saunderson: {
    readonly k1: typeof SAUNDERSON_K1;
    readonly k2: typeof SAUNDERSON_K2;
    readonly renderGeometry: "specular excluded (SPEX), Wacton rendering assumption";
  };
  readonly wavelengthStartNm: 380;
  readonly wavelengthEndNm: 750;
  readonly wavelengthIntervalNm: 10;
  readonly dataSource: {
    readonly title: "Artist Paint Spectral Database";
    readonly institution: "Rochester Institute of Technology";
    readonly paperUrl: string;
    readonly datasetPageUrl: string;
    readonly transcriptionProject: "Wacton.Unicolour";
    readonly transcriptionUrl: string;
    readonly transcriptionCommit: "3c888f040d89117a7c452076097beabd7ed766c8";
    readonly transcriptionFileSha256: "43c454d8e17f040ee82a1fde4aabd6c8bd0c30a7d2e99b5c0dfe0ca871870e2c";
    readonly embeddedProfileSha256: "9a125f240286f3f8f17c76b6f3da4532fcfae52e5bf357827e49b79a1cc372a2";
    readonly transcriptionLicense: "MIT";
  };
  readonly limitations: readonly string[];
}

export const PAINT_CALIBRATION_METADATA: PaintCalibrationMetadata =
  Object.freeze({
    profileVersion: "rit-artist-paint-two-constant-2016-v1",
    model: "Kubelka-Munk two-constant (K and S)",
    opticalAssumption: "opaque, optically infinite paint layer",
    ratioBasis: "relative-parts-of-complete-paint",
    ratioDescription:
      "A 2:1 recipe gives the first complete paint twice the K and S contribution of the second. Parts are relative paint amounts, not grams of dry pigment.",
    paintLine: "Golden Artist Colors Heavy Body acrylic",
    displayColorimetry: Object.freeze({
      illuminant: "CIE standard illuminant D65",
      observer: "CIE 1931 2 degree",
      outputSpace: "sRGB",
      chromaticAdaptation: "none (same D65 viewing illuminant)",
    }),
    saunderson: Object.freeze({
      k1: SAUNDERSON_K1,
      k2: SAUNDERSON_K2,
      renderGeometry:
        "specular excluded (SPEX), Wacton rendering assumption",
    }),
    wavelengthStartNm: 380,
    wavelengthEndNm: 750,
    wavelengthIntervalNm: 10,
    dataSource: Object.freeze({
      title: "Artist Paint Spectral Database",
      institution: "Rochester Institute of Technology",
      paperUrl:
        "https://www.rit.edu/science/sites/rit.edu.science/files/2019-03/ArtistSpectralDatabase.pdf",
      datasetPageUrl:
        "https://www.rit.edu/science/studio-scientific-imaging-and-archiving-cultural-heritage",
      transcriptionProject: "Wacton.Unicolour",
      transcriptionUrl:
        "https://gitlab.com/Wacton/Unicolour/-/blob/3c888f040d89117a7c452076097beabd7ed766c8/Unicolour.Datasets/ArtistPaint.cs",
      transcriptionCommit: "3c888f040d89117a7c452076097beabd7ed766c8",
      transcriptionFileSha256:
        "43c454d8e17f040ee82a1fde4aabd6c8bd0c30a7d2e99b5c0dfe0ca871870e2c",
      embeddedProfileSha256:
        "9a125f240286f3f8f17c76b6f3da4532fcfae52e5bf357827e49b79a1cc372a2",
      transcriptionLicense: "MIT",
    }),
    limitations: Object.freeze([
      "The current renderer uses the opaque infinite-thickness form; finite film thickness and paper reflectance are not yet modelled.",
      "The fixed K and S curves represent one measured paint system and cannot predict every brand, binder, pigment load, wet state, or particle dispersion.",
      "Fluorescent, metallic, pearlescent, interference, and strongly directional pigments require a different optical model.",
    ]),
  });

export interface TwoConstantPaintCalibration {
  readonly appKey: PigmentId;
  readonly paintName: string;
  readonly productNumber: number;
  readonly colourIndex: string;
  readonly sourceKind: "measured-derived-two-constant-profile";
  /** Wavelength-dependent absorption coefficient, relative to PW6 S = 1. */
  readonly absorptionK: readonly number[];
  /** Wavelength-dependent scattering coefficient, relative to PW6 S = 1. */
  readonly scatteringS: readonly number[];
  /** Compatibility view only; physical mixing combines K and S separately. */
  readonly ks: readonly number[];
}

const paintProfile = (
  appKey: PigmentId,
  paintName: string,
  productNumber: number,
  colourIndex: string,
  absorptionK: readonly number[],
  scatteringS: readonly number[],
): TwoConstantPaintCalibration => {
  if (
    absorptionK.length !== PAINT_CALIBRATION_WAVELENGTHS_NM.length ||
    scatteringS.length !== PAINT_CALIBRATION_WAVELENGTHS_NM.length
  ) {
    throw new RangeError(`${paintName} must cover every calibration wavelength`);
  }
  if (
    absorptionK.some((sample) => !Number.isFinite(sample) || sample < 0) ||
    scatteringS.some((sample) => !Number.isFinite(sample) || sample <= 0)
  ) {
    throw new RangeError(`${paintName} contains invalid K or S coefficients`);
  }

  const k = Object.freeze([...absorptionK]);
  const s = Object.freeze([...scatteringS]);
  return Object.freeze({
    appKey,
    paintName,
    productNumber,
    colourIndex,
    sourceKind: "measured-derived-two-constant-profile" as const,
    absorptionK: k,
    scatteringS: s,
    ks: Object.freeze(k.map((sample, index) => sample / s[index])),
  });
};

/**
 * The visible app terms remain 赤・青・黄・黒・白. The physical research
 * profile maps them to PR254, PB36, PY74, PBk9, and measured PW6. Red, blue,
 * and black preserve the established physical pigment identities; PY74 is the
 * available two-constant Hansa yellow profile replacing the former PY73
 * single-constant curve.
 */
export const PAINT_CALIBRATION: Readonly<
  Record<PigmentId, TwoConstantPaintCalibration>
> = Object.freeze({
  red: paintProfile(
    "red",
    "Pyrrole Red",
    1277,
    "PR254",
    [
      0.483940380996401, 0.363848467448973, 0.359078025426304, 0.377389903575027,
      0.428871496985627, 0.490580607637942, 0.549133547017755, 0.599817630003631,
      0.652313368062784, 0.704438578143703, 0.743191829626643, 0.77824899148161,
      0.816447915714897, 0.856553053934261, 0.892458955902224, 0.902180730401101,
      0.942924940612624, 1.02759345422596, 1.10142063699885, 1.09830060752944,
      0.894734698979902, 0.334737073508423, 0.0676494838087253, 0.0187125146354245,
      0.0062053478504012, 0.00229759333087518, 0.00109297024195805, 0.000686226699197375,
      0.000480882240316343, 0.000383144148142409, 0.000336724942358689, 0.00030589232678973,
      0.000269494021010445, 0.000257741787890615, 0.000209287131862309, 0.00016141194334912,
      0.000104386732841259, 0.0000576431081673246,
    ],
    [
      0.0524856779646625, 0.0328882894836738, 0.0282225721607793, 0.0270039999146508,
      0.0290506656387365, 0.0329251844307639, 0.0362808895611814, 0.0403990430116159,
      0.0446303049061979, 0.0477168796259863, 0.0499745140412382, 0.0521320895748694,
      0.0554614304202328, 0.0602024864024856, 0.060487293053693, 0.0585259506932303,
      0.0642953580588129, 0.0811673343697031, 0.101885485551041, 0.127361968663871,
      0.176044008483349, 0.319653307656777, 0.340177040344771, 0.293086027133168,
      0.247974637454973, 0.214774393702469, 0.201728580003713, 0.198762045662606,
      0.194319783682963, 0.20150866386452, 0.219842783582224, 0.241215299912446,
      0.25704615013763, 0.286498657030355, 0.274989327619379, 0.242950273965674,
      0.186404799472749, 0.12501764581294,
    ],
  ),
  blue: paintProfile(
    "blue",
    "Cerulean Blue Chromium",
    1050,
    "PB36",
    [
      0.0133354046554092, 0.012093233483682, 0.0116517036730394, 0.0117847006371695,
      0.0100836719798363, 0.00882301828495131, 0.00851628164853127, 0.00819067602363296,
      0.00755618345095524, 0.00728314571606456, 0.00748932998601572, 0.00699424668917065,
      0.00728297112774603, 0.0111980825315988, 0.0222916115578113, 0.041682212054853,
      0.0702660194253915, 0.0988570591907066, 0.124062123654683, 0.147582975281691,
      0.169527199896863, 0.187172351546988, 0.195369269375702, 0.192733006968411,
      0.194365916600947, 0.196851835771174, 0.18464009662425, 0.152554091609317,
      0.106534658709486, 0.0593539492830768, 0.0263125106921391, 0.00975720852832706,
      0.00336636909521219, 0.0012624312744228, 0.000595668157141402, 0.000368744886706667,
      0.000266651014607558, 0.00020739118488993,
    ],
    [
      0.0356287487004742, 0.039389035388052, 0.0411246837553901, 0.0405837696528551,
      0.0370080058349085, 0.0359336362205133, 0.0361336112990085, 0.0359128155450652,
      0.0359580653160987, 0.0359703685523537, 0.0357760953783999, 0.0359120999416895,
      0.035980636069107, 0.0351944433909252, 0.033711826997336, 0.0307794514931481,
      0.0282145576451149, 0.0266838006211547, 0.0261450221213699, 0.0264966542773035,
      0.027205465821255, 0.0282580544892635, 0.0295561079026878, 0.0308016289876924,
      0.0318219649359828, 0.033168858188905, 0.0352839606045832, 0.0380460529076816,
      0.0421664496351289, 0.0477481295024331, 0.0524691954590712, 0.0570481257145339,
      0.0601958433341133, 0.0637940479306278, 0.0669423773579248, 0.0694149497235832,
      0.0701525192845281, 0.069572364029629,
    ],
  ),
  yellow: paintProfile(
    "yellow",
    "Hansa Yellow Opaque",
    1191,
    "PY74",
    [
      0.512100081314837, 0.811954107142779, 0.996835843174264, 1.03542097315476,
      1.14380275493334, 1.26767584763054, 1.38775581120401, 1.48049450104339,
      1.56509313300391, 1.64537098200568, 1.60771582294544, 1.23476290443795,
      0.552126302713133, 0.112331062731325, 0.0229304072941642, 0.00500753830266314,
      0.00128547365574166, 0.000509307453590994, 0.000307730006717255, 0.000228204709284443,
      0.000182383391297429, 0.00015722690950228, 0.000137001467306171, 0.000126900159288766,
      0.000113462317995942, 0.0000973201365027879, 0.0000853528527658461, 0.0000815868187082281,
      0.0000666796560332411, 0.0000610226186316512, 0.0000617024155354409, 0.0000595032155240964,
      0.0000565189518580758, 0.0000528966316666848, 0.0000464661807975364, 0.0000391244360338891,
      0.0000314499697904531, 0.0000209850761970231,
    ],
    [
      0.1039844793085, 0.157386510904567, 0.189152295938482, 0.192470838701827,
      0.208077724465523, 0.22919197099569, 0.24358648366764, 0.246757704694342,
      0.261959728621277, 0.29137197376144, 0.320059907094168, 0.382814528275119,
      0.486895075082476, 0.402960722853954, 0.346376723690672, 0.279124659779846,
      0.207870305723293, 0.162818387170947, 0.141690553204417, 0.130726597690941,
      0.123392449945253, 0.120892884686133, 0.121175964256258, 0.123473811793775,
      0.12346294717639, 0.11756763367003, 0.11461346363485, 0.120387190599505,
      0.107511181874175, 0.107497724706644, 0.115852178615904, 0.119551716397322,
      0.122449970490674, 0.12064866043304, 0.113408147825366, 0.101750180782352,
      0.0901698646754337, 0.0662883462729863,
    ],
  ),
  black: paintProfile(
    "black",
    "Bone Black",
    1010,
    "PBk9",
    [
      0.317811397650624, 0.233952399653749, 0.204520371048808, 0.189464091220208,
      0.188813601474085, 0.193179768236094, 0.197596003482744, 0.20125972963409,
      0.205476953434866, 0.210521266582866, 0.214665979318831, 0.219283264175624,
      0.223502971430491, 0.2270276973869, 0.231948610107481, 0.235609647644616,
      0.239626943718284, 0.243894992385953, 0.248467548567963, 0.252355641801762,
      0.256408501038151, 0.261395774901768, 0.266028526662449, 0.270996613529048,
      0.275253176889181, 0.280079217451489, 0.284478263127754, 0.289275812641859,
      0.293656599811015, 0.297691582693998, 0.302184294796436, 0.30696834833567,
      0.31166846897385, 0.316528350896527, 0.321364207731934, 0.326021321634463,
      0.330457843304534, 0.335491912553359,
    ],
    [
      0.0368024813345649, 0.0256144995502153, 0.0212688767120403, 0.0187245793087216,
      0.0181165585542757, 0.0179541823875545, 0.01800808069532, 0.0181427634862488,
      0.0184240318104632, 0.0184508279908187, 0.0186306668048108, 0.0187291278524307,
      0.0189137102650178, 0.0192268634943196, 0.0193960093269549, 0.0195418435855256,
      0.0197873065716166, 0.0200967007231672, 0.0202413898889042, 0.0205466011989686,
      0.0208213525588727, 0.0208785976735545, 0.0213179808441358, 0.0214407055088138,
      0.0217703084725628, 0.0219333114484424, 0.0221982579405114, 0.0224842347757896,
      0.0226720929377712, 0.0230745165898883, 0.023304967775046, 0.0236739221366254,
      0.0238684455501154, 0.0242467924659702, 0.0245338061304657, 0.0247983914334245,
      0.0251572862923466, 0.0256406548024857,
    ],
  ),
  white: paintProfile(
    "white",
    "Titanium White",
    1380,
    "PW6",
    [
      0.530000769329713, 0.227441171751189, 0.0498131120761554, 0.00576033030453897,
      0.000366131570197074, 0.0000217207774522909, 0.00000605125963757896, 0.00000337163235815604,
      0.00000349994269723134, 0.00000573282062197724, 0.00000583632497383569, 0.00000789425609270285,
      0.00000881093187457671, 0.00000948797883015497, 0.0000120087957102917, 0.0000112716334893538,
      0.0000120685827448888, 0.000014148544896032, 0.0000175276099827109, 0.0000185529390077058,
      0.000020156631008877, 0.0000238469199482284, 0.0000256222124635562, 0.0000295602961060648,
      0.0000299353900951367, 0.0000292076538637935, 0.0000288941383383219, 0.0000264109710415787,
      0.0000246097905794744, 0.0000244348481085013, 0.0000260244699609715, 0.0000282723593948068,
      0.0000267212009146302, 0.0000273610952334719, 0.0000252046493198042, 0.0000230989707687595,
      0.0000182915524630804, 0.0000124765801191801,
    ],
    [
      1, 1, 1, 1,
      1, 1, 1, 1,
      1, 1, 1, 1,
      1, 1, 1, 1,
      1, 1, 1, 1,
      1, 1, 1, 1,
      1, 1, 1, 1,
      1, 1, 1, 1,
      1, 1, 1, 1,
      1, 1,
    ],
  ),
});

/** Backward-compatible K/S view; do not average these curves for mixing. */
export const PAINT_KS: Readonly<Record<PigmentId, readonly number[]>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(PAINT_CALIBRATION).map(([key, paint]) => [
        key,
        paint.ks,
      ]),
    ) as Record<PigmentId, readonly number[]>,
  );
