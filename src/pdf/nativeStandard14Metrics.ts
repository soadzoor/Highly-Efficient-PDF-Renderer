/**
 * PDF Standard-14 advance-width facts in 1000-unit glyph space.
 *
 * Generated from Adobe Core 35 AFM Files with 314 Glyph Entries:
 * https://mirrors.ctan.org/fonts/adobe/afm/Adobe-Core35_AFMs-314.tar.gz
 * Archive SHA-256: 6e6c53064ef6f40891ad72c06fab9f3c8fdcda80e03c9d0b21244cb1d4bf030b
 *
 * The source AFM files are not shipped. Their redistribution notice is
 * retained in THIRD_PARTY_NOTICES. Substitute sfnt files remain responsible
 * only for glyph selection and outlines; these facts control PDF positioning.
 * HEPR's separate Euro compatibility fallback uses each family's lining-
 * figure width; it is not represented as an AFM-sourced entry.
 */

export type NativeStandard14MetricFace =
  | "courier"
  | "helvetica"
  | "helvetica-bold"
  | "times-roman"
  | "times-italic"
  | "times-bold"
  | "times-bold-italic"
  | "symbol"
  | "zapf-dingbats";

const FONT_ALIASES = Object.freeze({
  "courier": "courier",
  "courierbold": "courier",
  "courieroblique": "courier",
  "courieritalic": "courier",
  "courierboldoblique": "courier",
  "courierbolditalic": "courier",
  "couriernew": "courier",
  "couriernewps": "courier",
  "couriernewpsmt": "courier",
  "couriernewbold": "courier",
  "couriernewboldmt": "courier",
  "couriernewpsboldmt": "courier",
  "couriernewoblique": "courier",
  "couriernewobliquemt": "courier",
  "couriernewitalic": "courier",
  "couriernewitalicmt": "courier",
  "couriernewpsitalicmt": "courier",
  "couriernewboldoblique": "courier",
  "couriernewboldobliquemt": "courier",
  "couriernewbolditalic": "courier",
  "couriernewbolditalicmt": "courier",
  "couriernewpsbolditalicmt": "courier",
  "helvetica": "helvetica",
  "helveticaoblique": "helvetica",
  "helveticaitalic": "helvetica",
  "helveticabold": "helvetica-bold",
  "helveticaboldoblique": "helvetica-bold",
  "helveticabolditalic": "helvetica-bold",
  "arial": "helvetica",
  "arialmt": "helvetica",
  "arialoblique": "helvetica",
  "arialobliquemt": "helvetica",
  "arialitalic": "helvetica",
  "arialitalicmt": "helvetica",
  "arialbold": "helvetica-bold",
  "arialboldmt": "helvetica-bold",
  "arialboldoblique": "helvetica-bold",
  "arialboldobliquemt": "helvetica-bold",
  "arialbolditalic": "helvetica-bold",
  "arialbolditalicmt": "helvetica-bold",
  "times": "times-roman",
  "timesroman": "times-roman",
  "timesitalic": "times-italic",
  "timesbold": "times-bold",
  "timesbolditalic": "times-bold-italic",
  "timesnewroman": "times-roman",
  "timesnewromanps": "times-roman",
  "timesnewromanpsmt": "times-roman",
  "timesnewromanitalic": "times-italic",
  "timesnewromanitalicmt": "times-italic",
  "timesnewromanpsitalicmt": "times-italic",
  "timesnewromanbold": "times-bold",
  "timesnewromanboldmt": "times-bold",
  "timesnewromanpsboldmt": "times-bold",
  "timesnewromanbolditalic": "times-bold-italic",
  "timesnewromanbolditalicmt": "times-bold-italic",
  "timesnewromanpsbolditalicmt": "times-bold-italic",
  "symbol": "symbol",
  "symbolmt": "symbol",
  "zapfdingbats": "zapf-dingbats",
  "zapfdingbatsitc": "zapf-dingbats",
  "zapfdingbatsstd": "zapf-dingbats",
  "itczapfdingbats": "zapf-dingbats",
  "itczapfdingbatsstd": "zapf-dingbats",
} satisfies Readonly<Record<string, NativeStandard14MetricFace>>);

const LATIN_GLYPH_NAMES = `
space exclam quotedbl numbersign dollar percent ampersand quoteright parenleft parenright asterisk plus comma hyphen period slash
zero one two three four five six seven eight nine colon semicolon less equal greater question
at A B C D E F G H I J K L M N O
P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore
quoteleft a b c d e f g h i j k l m n o
p q r s t u v w x y z braceleft bar braceright asciitilde exclamdown
cent sterling fraction yen florin section currency quotesingle quotedblleft guillemotleft guilsinglleft guilsinglright fi fl endash dagger
daggerdbl periodcentered paragraph bullet quotesinglbase quotedblbase quotedblright guillemotright ellipsis perthousand questiondown grave acute circumflex tilde macron
breve dotaccent dieresis ring cedilla hungarumlaut ogonek caron emdash AE ordfeminine Lslash Oslash OE ordmasculine ae
dotlessi lslash oslash oe germandbls Idieresis eacute abreve uhungarumlaut ecaron Ydieresis divide Yacute Acircumflex aacute Ucircumflex
yacute scommaaccent ecircumflex Uring Udieresis aogonek Uacute uogonek Edieresis Dcroat commaaccent copyright Emacron ccaron aring Ncommaaccent
lacute agrave Tcommaaccent Cacute atilde Edotaccent scaron scedilla iacute lozenge Rcaron Gcommaaccent ucircumflex acircumflex Amacron rcaron
ccedilla Zdotaccent Thorn Omacron Racute Sacute dcaron Umacron uring threesuperior Ograve Agrave Abreve multiply uacute Tcaron
partialdiff ydieresis Nacute icircumflex Ecircumflex adieresis edieresis cacute nacute umacron Ncaron Iacute plusminus brokenbar registered Gbreve
Idotaccent summation Egrave racute omacron Zacute Zcaron greaterequal Eth Ccedilla lcommaaccent tcaron eogonek Uogonek Aacute Adieresis
egrave zacute iogonek Oacute oacute amacron sacute idieresis Ocircumflex Ugrave Delta thorn twosuperior Odieresis mu igrave
ohungarumlaut Eogonek dcroat threequarters Scedilla lcaron Kcommaaccent Lacute trademark edotaccent Igrave Imacron Lcaron onehalf lessequal ocircumflex
ntilde Uhungarumlaut Eacute emacron gbreve onequarter Scaron Scommaaccent Ohungarumlaut degree ograve Ccaron ugrave radical Dcaron rcommaaccent
Ntilde otilde Rcommaaccent Lcommaaccent Atilde Aogonek Aring Otilde zdotaccent Ecaron Iogonek kcommaaccent minus Icircumflex ncaron tcommaaccent
logicalnot odieresis udieresis notequal gcommaaccent eth zcaron ncommaaccent onesuperior imacron
`;

const LATIN_WIDTH_DATA: Readonly<Partial<Record<NativeStandard14MetricFace, string>>> =
  Object.freeze({
    helvetica: `
278 278 355 556 556 889 667 222 333 333 389 584 278 333 278 278
556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556
1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778
667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556
222 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556
556 556 333 500 278 556 500 722 500 500 500 334 260 334 584 333
556 556 167 556 556 556 556 191 333 556 333 333 500 500 556 556
556 278 537 350 222 333 333 556 1000 1000 611 333 333 333 333 333
333 333 333 333 333 333 333 333 1000 1000 370 556 778 1000 365 889
278 222 611 944 611 278 556 556 556 556 667 584 667 667 556 722
500 500 556 722 722 556 722 556 667 722 250 737 667 500 556 722
222 556 611 722 556 667 500 500 278 471 722 778 556 556 667 333
500 611 667 778 722 667 643 722 556 333 778 667 667 584 556 611
476 500 722 278 667 556 556 500 556 556 722 278 584 260 737 778
278 600 667 333 556 611 611 549 722 722 222 317 556 722 667 667
556 500 222 778 556 556 500 278 778 722 612 556 333 778 556 278
556 667 556 834 667 299 667 556 1000 556 278 278 556 834 549 556
556 722 667 556 556 834 667 667 778 400 556 722 556 453 722 333
722 556 722 556 667 667 667 778 500 667 278 500 584 278 556 278
584 556 556 549 556 556 500 556 333 278
`,
    "helvetica-bold": `
278 333 474 556 556 889 722 278 333 333 389 584 278 333 278 278
556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611
975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778
667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556
278 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611
611 611 389 556 333 611 556 778 556 556 500 389 280 389 584 333
556 556 167 556 556 556 556 238 500 556 333 333 611 611 556 556
556 278 556 350 278 500 500 556 1000 1000 611 333 333 333 333 333
333 333 333 333 333 333 333 333 1000 1000 370 611 778 1000 365 889
278 278 611 944 611 278 556 556 611 556 667 584 667 722 556 722
556 556 556 722 722 556 722 611 667 722 250 737 667 556 556 722
278 556 611 722 556 667 556 556 278 494 722 778 611 556 722 389
556 611 667 778 722 667 743 722 611 333 778 722 722 584 611 611
494 556 722 278 667 556 556 556 611 611 722 278 584 280 737 778
278 600 667 389 611 611 611 549 722 722 278 389 556 722 722 722
556 500 278 778 611 556 556 278 778 722 612 611 333 778 611 278
611 667 611 834 667 400 722 611 1000 556 278 278 611 834 549 611
611 722 667 556 611 834 667 667 778 400 611 722 611 549 722 389
722 611 722 611 722 722 722 778 500 667 278 556 584 278 611 333
584 611 611 549 611 611 500 611 333 278
`,
    "times-roman": `
250 333 408 500 500 833 778 333 333 333 500 564 250 333 250 278
500 500 500 500 500 500 500 500 500 500 278 278 564 564 564 444
921 722 667 667 722 611 556 722 722 333 389 722 611 889 722 722
556 722 667 556 611 722 722 944 722 722 611 333 278 333 469 500
333 444 500 444 500 444 333 500 500 278 278 500 278 778 500 500
500 500 333 389 278 500 500 722 500 500 444 480 200 480 541 333
500 500 167 500 500 500 500 180 444 500 333 333 556 556 500 500
500 250 453 350 333 444 444 500 1000 1000 444 333 333 333 333 333
333 333 333 333 333 333 333 333 1000 889 276 611 722 889 310 667
278 278 500 722 500 333 444 444 500 444 722 564 722 722 444 722
500 389 444 722 722 444 722 500 611 722 250 760 611 444 444 722
278 444 611 667 444 611 389 389 278 471 667 722 500 444 722 333
444 611 556 722 667 556 588 722 500 300 722 722 722 564 500 611
476 500 722 278 611 444 444 444 500 500 722 333 564 200 760 722
333 600 611 333 500 611 611 549 722 667 278 326 444 722 722 722
444 444 278 722 500 444 389 278 722 722 612 500 300 722 500 278
500 611 500 750 556 344 722 611 980 444 333 333 611 750 549 500
500 722 611 444 500 750 556 556 722 400 500 667 500 453 722 333
722 500 667 611 722 722 722 722 444 611 333 500 564 333 500 278
564 500 500 549 500 500 444 500 300 278
`,
    "times-italic": `
250 333 420 500 500 833 778 333 333 333 500 675 250 333 250 278
500 500 500 500 500 500 500 500 500 500 333 333 675 675 675 500
920 611 611 667 722 611 611 722 722 333 444 667 556 833 667 722
611 722 611 500 556 722 611 833 611 556 556 389 278 389 422 500
333 500 500 444 500 444 278 500 500 278 278 444 278 722 500 500
500 500 389 389 278 500 444 667 444 444 389 400 275 400 541 389
500 500 167 500 500 500 500 214 556 500 333 333 500 500 500 500
500 250 523 350 333 556 556 500 889 1000 500 333 333 333 333 333
333 333 333 333 333 333 333 333 889 889 276 556 722 944 310 667
278 278 500 667 500 333 444 500 500 444 556 675 556 611 500 722
444 389 444 722 722 500 722 500 611 722 250 760 611 444 500 667
278 500 556 667 500 611 389 389 278 471 611 722 500 500 611 389
444 556 611 722 611 500 544 722 500 300 722 611 611 675 500 556
476 444 667 278 611 500 444 444 500 500 667 333 675 275 760 722
333 600 611 389 500 556 556 549 722 667 278 300 444 722 611 611
444 389 278 722 500 500 389 278 722 722 612 500 300 722 500 278
500 611 500 750 500 300 667 556 980 444 333 333 611 750 549 500
500 722 611 444 500 750 500 500 722 400 500 667 500 453 722 389
667 500 611 556 611 611 611 722 389 611 333 444 675 333 500 278
675 500 500 549 500 500 389 500 300 278
`,
    "times-bold": `
250 333 555 500 500 1000 833 333 333 333 500 570 250 333 250 278
500 500 500 500 500 500 500 500 500 500 333 333 570 570 570 500
930 722 667 722 722 667 611 778 778 389 500 778 667 944 722 778
611 778 722 556 667 722 722 1000 722 722 667 333 278 333 581 500
333 500 556 444 556 444 333 500 556 278 333 556 278 833 556 500
556 556 444 389 333 556 500 722 500 500 444 394 220 394 520 333
500 500 167 500 500 500 500 278 500 500 333 333 556 556 500 500
500 250 540 350 333 500 500 500 1000 1000 500 333 333 333 333 333
333 333 333 333 333 333 333 333 1000 1000 300 667 778 1000 330 722
278 278 500 722 556 389 444 500 556 444 722 570 722 722 500 722
500 389 444 722 722 500 722 556 667 722 250 747 667 444 500 722
278 500 667 722 500 667 389 389 278 494 722 778 556 500 722 444
444 667 611 778 722 556 672 722 556 300 778 722 722 570 556 667
494 500 722 278 667 500 444 444 556 556 722 389 570 220 747 778
389 600 667 444 500 667 667 549 722 722 278 416 444 722 722 722
444 444 278 778 500 500 389 278 778 722 612 556 300 778 556 278
500 667 556 750 556 394 778 667 1000 444 389 389 667 750 549 500
556 722 667 444 500 750 556 556 778 400 500 722 556 549 722 444
722 500 722 667 722 722 722 778 444 667 389 556 570 389 556 333
570 500 556 549 500 500 444 556 300 278
`,
    "times-bold-italic": `
250 389 555 500 500 833 778 333 333 333 500 570 250 333 250 278
500 500 500 500 500 500 500 500 500 500 333 333 570 570 570 500
832 667 667 667 722 667 667 722 778 389 500 667 611 889 722 722
611 722 667 556 611 722 667 889 667 611 611 333 278 333 570 500
333 500 500 444 500 444 333 500 556 278 278 500 278 778 556 500
500 500 389 389 278 556 444 667 500 444 389 348 220 348 570 389
500 500 167 500 500 500 500 278 500 500 333 333 556 556 500 500
500 250 500 350 333 500 500 500 1000 1000 500 333 333 333 333 333
333 333 333 333 333 333 333 333 1000 944 266 611 722 944 300 722
278 278 500 722 500 389 444 500 556 444 611 570 611 667 500 722
444 389 444 722 722 500 722 556 667 722 250 747 667 444 500 722
278 500 611 667 500 667 389 389 278 494 667 722 556 500 667 389
444 611 611 722 667 556 608 722 556 300 722 667 667 570 556 611
494 444 722 278 667 500 444 444 556 556 722 389 570 220 747 722
389 600 667 389 500 611 611 549 722 667 278 366 444 722 667 667
444 389 278 722 500 500 389 278 722 722 612 500 300 722 576 278
500 667 500 750 556 382 667 611 1000 444 389 389 611 750 549 500
556 722 667 444 500 750 556 556 722 400 500 667 556 549 722 389
722 500 667 611 667 667 667 722 389 667 389 500 606 389 556 278
606 500 556 549 500 500 389 556 300 278
`
  });

const SYMBOL_METRICS = `
space 250 exclam 333 universal 713 numbersign 500 existential 549 percent 833
ampersand 778 suchthat 439 parenleft 333 parenright 333 asteriskmath 500 plus 549
comma 250 minus 549 period 250 slash 278 zero 500 one 500
two 500 three 500 four 500 five 500 six 500 seven 500
eight 500 nine 500 colon 278 semicolon 278 less 549 equal 549
greater 549 question 444 congruent 549 Alpha 722 Beta 667 Chi 722
Delta 612 Epsilon 611 Phi 763 Gamma 603 Eta 722 Iota 333
theta1 631 Kappa 722 Lambda 686 Mu 889 Nu 722 Omicron 722
Pi 768 Theta 741 Rho 556 Sigma 592 Tau 611 Upsilon 690
sigma1 439 Omega 768 Xi 645 Psi 795 Zeta 611 bracketleft 333
therefore 863 bracketright 333 perpendicular 658 underscore 500 radicalex 500 alpha 631
beta 549 chi 549 delta 494 epsilon 439 phi 521 gamma 411
eta 603 iota 329 phi1 603 kappa 549 lambda 549 mu 576
nu 521 omicron 549 pi 549 theta 521 rho 549 sigma 603
tau 439 upsilon 576 omega1 713 omega 686 xi 493 psi 686
zeta 494 braceleft 480 bar 200 braceright 480 similar 549 Euro 750
Upsilon1 620 minute 247 lessequal 549 fraction 167 infinity 713 florin 500
club 753 diamond 753 heart 753 spade 753 arrowboth 1042 arrowleft 987
arrowup 603 arrowright 987 arrowdown 603 degree 400 plusminus 549 second 411
greaterequal 549 multiply 549 proportional 713 partialdiff 494 bullet 460 divide 549
notequal 549 equivalence 549 approxequal 549 ellipsis 1000 arrowvertex 603 arrowhorizex 1000
carriagereturn 658 aleph 823 Ifraktur 686 Rfraktur 795 weierstrass 987 circlemultiply 768
circleplus 768 emptyset 823 intersection 768 union 768 propersuperset 713 reflexsuperset 713
notsubset 713 propersubset 713 reflexsubset 713 element 713 notelement 713 angle 768
gradient 713 registerserif 790 copyrightserif 790 trademarkserif 890 product 823 radical 549
dotmath 250 logicalnot 713 logicaland 603 logicalor 603 arrowdblboth 1042 arrowdblleft 987
arrowdblup 603 arrowdblright 987 arrowdbldown 603 lozenge 494 angleleft 329 registersans 790
copyrightsans 790 trademarksans 786 summation 713 parenlefttp 384 parenleftex 384 parenleftbt 384
bracketlefttp 384 bracketleftex 384 bracketleftbt 384 bracelefttp 494 braceleftmid 494 braceleftbt 494
braceex 494 angleright 329 integral 274 integraltp 686 integralex 686 integralbt 686
parenrighttp 384 parenrightex 384 parenrightbt 384 bracketrighttp 384 bracketrightex 384 bracketrightbt 384
bracerighttp 494 bracerightmid 494 bracerightbt 494 apple 790
`;
const ZAPF_DINGBATS_METRICS = `
space 278 a1 974 a2 961 a202 974 a3 980 a4 719
a5 789 a119 790 a118 791 a117 690 a11 960 a12 939
a13 549 a14 855 a15 911 a16 933 a105 911 a17 945
a18 974 a19 755 a20 846 a21 762 a22 761 a23 571
a24 677 a25 763 a26 760 a27 759 a28 754 a6 494
a7 552 a8 537 a9 577 a10 692 a29 786 a30 788
a31 788 a32 790 a33 793 a34 794 a35 816 a36 823
a37 789 a38 841 a39 823 a40 833 a41 816 a42 831
a43 923 a44 744 a45 723 a46 749 a47 790 a48 792
a49 695 a50 776 a51 768 a52 792 a53 759 a54 707
a55 708 a56 682 a57 701 a58 826 a59 815 a60 789
a61 789 a62 707 a63 687 a64 696 a65 689 a66 786
a67 787 a68 713 a69 791 a70 785 a71 791 a72 873
a73 761 a74 762 a203 762 a75 759 a204 759 a76 892
a77 892 a78 788 a79 784 a81 438 a82 138 a83 277
a84 415 a97 392 a98 392 a99 668 a100 668 a89 390
a90 390 a93 317 a94 317 a91 276 a92 276 a205 509
a85 509 a206 410 a86 410 a87 234 a88 234 a95 334
a96 334 a101 732 a102 544 a103 544 a104 910 a106 667
a107 760 a108 760 a112 776 a111 595 a110 694 a109 626
a120 788 a121 788 a122 788 a123 788 a124 788 a125 788
a126 788 a127 788 a128 788 a129 788 a130 788 a131 788
a132 788 a133 788 a134 788 a135 788 a136 788 a137 788
a138 788 a139 788 a140 788 a141 788 a142 788 a143 788
a144 788 a145 788 a146 788 a147 788 a148 788 a149 788
a150 788 a151 788 a152 788 a153 788 a154 788 a155 788
a156 788 a157 788 a158 788 a159 788 a160 894 a161 838
a163 1016 a164 458 a196 748 a165 924 a192 748 a166 918
a167 927 a168 928 a169 928 a170 834 a171 873 a172 828
a173 924 a162 924 a174 917 a175 930 a176 931 a177 463
a178 883 a179 836 a193 836 a180 867 a199 867 a181 696
a200 696 a182 874 a201 874 a183 760 a184 946 a197 771
a185 865 a194 771 a198 888 a186 967 a195 888 a187 831
a188 873 a189 927 a190 970 a191 918
`;

let latinGlyphIndexes: ReadonlyMap<string, number> | null = null;
const latinWidths = new Map<NativeStandard14MetricFace, Uint16Array>();
let symbolWidths: ReadonlyMap<string, number> | null = null;
let zapfDingbatWidths: ReadonlyMap<string, number> | null = null;

/** Resolve exact Standard-14 names and common metric-compatible PostScript aliases. */
export function resolveNativeStandard14MetricFace(
  baseFont: string
): NativeStandard14MetricFace | null {
  const stripped = /^[A-Z]{6}\+/.test(baseFont) ? baseFont.slice(7) : baseFont;
  const normalized = stripped.toLowerCase().replace(/[\s,_-]+/g, "");
  return FONT_ALIASES[normalized as keyof typeof FONT_ALIASES] ?? null;
}

/**
 * Return a standard advance width, or null when the named glyph is not part
 * of the selected Standard-14 font's metric program.
 */
export function nativeStandard14GlyphWidth(
  face: NativeStandard14MetricFace,
  glyphName: string | null
): number | null {
  if (glyphName === null || glyphName.length === 0 || glyphName === ".notdef") return null;
  if (face === "symbol") return sparseWidths("symbol").get(glyphName) ?? null;
  if (face === "zapf-dingbats") return sparseWidths("zapf-dingbats").get(glyphName) ?? null;

  const glyphIndex = latinIndexes().get(glyphName);
  if (glyphIndex === undefined) {
    // Euro was standardized after the 1997 314-glyph AFM set. Its established
    // Core-14 advance equals a lining figure in each Latin family.
    if (glyphName === "Euro") {
      return face === "courier" ? 600 : face.startsWith("helvetica") ? 556 : 500;
    }
    return null;
  }
  if (face === "courier") return 600;
  return latinWidthVector(face)[glyphIndex] ?? null;
}

function latinIndexes(): ReadonlyMap<string, number> {
  if (latinGlyphIndexes) return latinGlyphIndexes;
  const names = tokens(LATIN_GLYPH_NAMES);
  if (names.length !== 314) {
    throw new RangeError(`Standard-14 Latin table has ${names.length} glyphs; expected 314.`);
  }
  const indexes = new Map<string, number>();
  for (let index = 0; index < names.length; index += 1) {
    if (indexes.has(names[index])) {
      throw new RangeError(`Standard-14 Latin table repeats glyph ${names[index]}.`);
    }
    indexes.set(names[index], index);
  }
  latinGlyphIndexes = indexes;
  return latinGlyphIndexes;
}

function latinWidthVector(face: NativeStandard14MetricFace): Uint16Array {
  const cached = latinWidths.get(face);
  if (cached) return cached;
  const source = LATIN_WIDTH_DATA[face];
  if (!source) throw new RangeError(`Standard-14 face ${face} has no Latin width vector.`);
  const values = tokens(source);
  const expectedLength = latinIndexes().size;
  if (values.length !== expectedLength) {
    throw new RangeError(
      `Standard-14 face ${face} has ${values.length} widths; expected ${expectedLength}.`
    );
  }
  const widths = new Uint16Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const width = Number(values[index]);
    if (!Number.isSafeInteger(width) || width < 0 || width > 0xffff) {
      throw new RangeError(`Standard-14 face ${face} has an invalid width.`);
    }
    widths[index] = width;
  }
  latinWidths.set(face, widths);
  return widths;
}

function sparseWidths(
  face: "symbol" | "zapf-dingbats"
): ReadonlyMap<string, number> {
  const cached = face === "symbol" ? symbolWidths : zapfDingbatWidths;
  if (cached) return cached;
  const values = tokens(face === "symbol" ? SYMBOL_METRICS : ZAPF_DINGBATS_METRICS);
  const expectedEntries = face === "symbol" ? 190 : 202;
  if (values.length !== expectedEntries * 2) {
    throw new RangeError(
      `Standard-14 face ${face} has ${values.length / 2} metrics; expected ${expectedEntries}.`
    );
  }
  const widths = new Map<string, number>();
  for (let index = 0; index < values.length; index += 2) {
    const glyphName = values[index];
    if (widths.has(glyphName)) {
      throw new RangeError(`Standard-14 face ${face} repeats glyph ${glyphName}.`);
    }
    const width = Number(values[index + 1]);
    if (!Number.isSafeInteger(width) || width < 0 || width > 0xffff) {
      throw new RangeError(`Standard-14 face ${face} has an invalid width.`);
    }
    widths.set(glyphName, width);
  }
  if (face === "symbol") symbolWidths = widths;
  else zapfDingbatWidths = widths;
  return widths;
}

function tokens(source: string): string[] {
  return source.trim().split(/\s+/);
}
