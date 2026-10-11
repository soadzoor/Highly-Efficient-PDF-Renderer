These JPEG 2000 images are synthetic 8x8 constant-color fixtures generated with
ImageMagick 6.9.12 / OpenJPEG 2.5.0, using `convert input.pam -depth 8 -quality 100 output.jp2`
(depth 16 for `gray16`). Values are RGB `(16,85,204)`, gray `64`, and straight
alpha `128`. They contain no third-party artwork. The JBIG2 test page and globals
are assembled from segment and fax bits in `scripts/lib/imageCodecFixtures.mjs`.

The `gray*-3x2.jp2` fixtures contain a six-sample ramp from zero to the maximum
unsigned value (or the corresponding signed range). Precisions are 1, 2, 4,
signed 8, unsigned/signed 12 and signed 16 bits. Their odd width checks packed
row padding. `ycc420-6x4.jp2` contains subsampled YCbCr ramps. These are generated
losslessly with OpenJPEG 2.5.0 by `scripts/lib/generateJpxPrecisionFixtures.c`:

```sh
cc scripts/lib/generateJpxPrecisionFixtures.c $(pkg-config --cflags --libs libopenjp2) -o /tmp/jpx-fixtures
/tmp/jpx-fixtures gray12s-3x2.jp2 12 1
/tmp/jpx-fixtures ycc420-6x4.jp2 ycc 0
```
