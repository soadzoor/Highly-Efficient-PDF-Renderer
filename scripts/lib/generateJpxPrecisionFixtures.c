// Synthetic, lossless JPX regression fixtures. Usage: output.jp2 precision signed
// (precision may be "ycc" for a subsampled YCbCr fixture). Requires OpenJPEG 2.5.
#include <openjpeg.h>
#include <stdlib.h>
#include <string.h>
int main(int argc, char **argv) {
  if(argc!=4) return 2;
  int ycc=strcmp(argv[2],"ycc")==0;
  int precision=ycc?8:atoi(argv[2]), sign=atoi(argv[3]), width=ycc?6:3, height=ycc?4:2;
  if(precision<1 || precision>16 || (sign!=0 && sign!=1)) return 2;
  opj_image_cmptparm_t component={0}; component.dx=component.dy=1;
  component.w=width; component.h=height; component.prec=precision; component.sgnd=sign;
  opj_image_cmptparm_t channels[3]={component,component,component};
  if(ycc) for(int c=1;c<3;c++) { channels[c].dx=channels[c].dy=2; channels[c].w=width/2; channels[c].h=height/2; }
  opj_image_t *image=opj_image_create(ycc?3:1,channels,ycc?OPJ_CLRSPC_SYCC:OPJ_CLRSPC_GRAY);
  image->x1=width; image->y1=height;
  for(int i=0;i<width*height;i++) image->comps[0].data[i]=(i*((1<<precision)-1)/(width*height-1))-(sign?(1<<(precision-1)):0);
  if(ycc) for(int c=0;c<3;c++) for(unsigned i=0;i<image->comps[c].w*image->comps[c].h;i++)
    image->comps[c].data[i]=c==0?64+i*4:c==1?128+i*2:180-i*3;
  opj_cparameters_t parameters; opj_set_default_encoder_parameters(&parameters);
  parameters.tcp_numlayers=1; parameters.tcp_rates[0]=0; parameters.cp_disto_alloc=1; parameters.numresolution=1;
  opj_codec_t *codec=opj_create_compress(OPJ_CODEC_JP2);
  opj_stream_t *stream=opj_stream_create_default_file_stream(argv[1],0);
  int success=opj_setup_encoder(codec,&parameters,image)&&opj_start_compress(codec,image,stream)&&opj_encode(codec,stream)&&opj_end_compress(codec,stream);
  opj_stream_destroy(stream); opj_destroy_codec(codec); opj_image_destroy(image);
  return success?0:1;
}
