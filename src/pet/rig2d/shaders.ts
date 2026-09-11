export const vertexShader = `precision highp float;attribute vec2 a_pos;varying vec2 v_pixel;uniform float u_time,u_amount,u_mode;uniform vec2 u_neck;
  mat2 rot(float a){return mat2(cos(a),sin(a),-sin(a),cos(a));}
  float ellipse(vec2 p,vec2 c,vec2 r){float d=length((p-c)/r);return 1.-smoothstep(.3,1.,d);}
  void main(){vec2 src=a_pos;vec2 p=src;v_pixel=src;float t=u_time,a=u_amount,b=sin(t*2.05);float head=1.-smoothstep(u_neck.y-34.,u_neck.y+25.,src.y);
   // A visible, slow breath; the contact line stays fixed as the body rises.
   if(u_mode>4.5){float breath=(1.-cos(t*1.30899694))*.5;float lift=1.-smoothstep(420.,470.,src.y);p.y-=breath*5.5*a*lift;p.x+=(src.x-256.)*.006*breath*a*lift;gl_Position=vec4(p.x/256.-1.,1.-p.y/256.,0.,1.);return;}
   float angle=sin(t*1.13)*.012,dx=sin(t*.81)*1.2,dy=-b*1.8;
   if(u_mode>.5&&u_mode<1.5){angle=sin(t*1.45)*.027;dx=sin(t*.7)*1.8;}
   if(u_mode>1.5&&u_mode<2.5){angle=sin(t*3.)*.013;dy+=sin(t*3.2)*1.3;}
   if(u_mode>2.5&&u_mode<3.5){angle=sin(t*2.6)*.008;dy+=2.5+sin(t*4.7)*3.;}
   if(u_mode>3.5){float burst=pow(max(0.,sin(t*1.9)),2.);angle=sin(t*14.)*.023*burst;dx=sin(t*14.)*1.8*burst;dy-=2.*burst;}
   vec2 h=src-u_neck;p+=(rot(angle*a)*h-h)*head+vec2(dx,dy)*head*a;
   float body=smoothstep(u_neck.y-15.,u_neck.y+50.,src.y)*(1.-smoothstep(420.,468.,src.y))*smoothstep(169.,230.,src.x);p.x+=(src.x-u_neck.x)*.006*b*a*body;p.y-=1.1*b*a*body;
   float tail=(1.-smoothstep(183.,236.,src.x))*smoothstep(320.,362.,src.y);p+=vec2(sin(t*1.7)*3.,sin(t*1.7+.5)*4.)*tail*a;
   if(u_mode>.5&&u_mode<1.5){float paw=ellipse(src,vec2(240.,284.),vec2(49.,60.));p+=vec2(sin(t*2.3)*1.6,sin(t*2.3)*2.4)*paw*a;}
   if(u_mode>1.5&&u_mode<2.5){float paw=(1.-smoothstep(193.,244.,src.x))*smoothstep(245.,274.,src.y)*(1.-smoothstep(328.,367.,src.y));vec2 d=src-vec2(234.,324.);p+=(rot(sin(t*4.4)*.085*a)*d-d)*paw;}
   if(u_mode>2.5&&u_mode<3.5){float l=ellipse(src,vec2(257.,419.),vec2(45.,73.));float r=ellipse(src,vec2(356.,422.),vec2(46.,68.));float tap=sin(t*7.);p.y-=(l*max(0.,tap)+r*max(0.,-tap))*19.*a;p.x+=(l-r)*sin(t*7.)*1.5*a;}
   if(u_mode>3.5){float l=ellipse(src,vec2(193.,240.),vec2(50.,69.));float r=ellipse(src,vec2(381.,280.),vec2(46.,63.));p+=vec2(sin(t*13.)*2.,sin(t*9.)*2.5)*(l+r)*a;}
   gl_Position=vec4(p.x/256.-1.,1.-p.y/256.,0.,1.);
  }`;
export const fragmentShader = `precision highp float;varying vec2 v_pixel;uniform sampler2D u_base,u_blinkTexture,u_closedMouth;uniform mat3 u_blinkMap,u_mouthMap;uniform vec4 u_eyes,u_mouth;uniform vec2 u_eyeRadius;uniform float u_eyeAngle,u_blink,u_open,u_mode,u_opacity;
   float patch(vec2 p,vec2 c,vec2 r,float angle){vec2 d=p-c;float co=cos(angle),si=sin(angle);d=vec2(co*d.x+si*d.y,-si*d.x+co*d.y);return 1.-smoothstep(.73,1.,length(d/r));}
   void main(){vec2 p=v_pixel;vec4 original=texture2D(u_base,p/512.);vec4 result=original;
    if(u_mode>4.5){gl_FragColor=vec4(original.rgb,original.a*u_opacity);return;}
    float eyes=max(patch(p,u_eyes.xy,u_eyeRadius,u_eyeAngle),patch(p,u_eyes.zw,u_eyeRadius,u_eyeAngle));
    if(u_blink>.001&&eyes>.001){vec2 uv=(u_blinkMap*vec3(p,1.)).xy/512.;vec4 closed=texture2D(u_blinkTexture,uv);result.rgb=mix(result.rgb,closed.rgb,u_blink*eyes);}
    if(u_mode>1.5&&u_mode<2.5){float area=patch(p,u_mouth.xy,u_mouth.zw,.12);if(area>.001){vec2 uv=(u_mouthMap*vec3(p,1.)).xy/512.;vec3 closed=texture2D(u_closedMouth,uv).rgb;vec2 samplePoint=p;float squash=.45+.55*u_open;samplePoint.y=u_mouth.y+(p.y-u_mouth.y)/squash;vec3 open=texture2D(u_base,samplePoint/512.).rgb;vec3 mouth=mix(closed,open,smoothstep(.12,.75,u_open));result.rgb=mix(result.rgb,mouth,area);}}
    result.a=original.a*u_opacity;gl_FragColor=result;
   }`;
