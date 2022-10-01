class ColorProfileManager {
  constructor() {
    const YELLOW = "#FFFD4E";
    const RED = "#FF2424";
    const BLUE = "#009FF8";
    const BLACK = "#6E6E6E";
    const GREEN = "#00F862";
    const WHITE = "#FFFFFF";
    const PINK = "#FF3EFD";
    const PURPLE = "#6B34FF";
    const ALL_BLACK = [BLACK, BLACK, BLACK, BLACK];
    const ALL_WHITE = [WHITE, WHITE, WHITE, WHITE];
    const ALL_RED = [RED, RED, RED, RED];
    const ALL_BLUE = [BLUE, BLUE, BLUE, BLUE];
    const ALL_GREEN = [GREEN, GREEN, GREEN, GREEN];
    const ALL_YELLOW = [YELLOW, YELLOW, YELLOW, YELLOW];
    const ALL_PINK = [PINK, PINK, PINK, PINK];
    this.profiles = {
      // IDLE --> ACTIVE
      default: [PINK, GREEN, PINK, GREEN, ...ALL_RED],
      0: [YELLOW, GREEN, RED, PINK, ...ALL_WHITE],
      1: [BLUE, RED, RED, BLUE, ...ALL_WHITE],
      2: [BLUE, PINK, PINK, BLUE, ...ALL_WHITE],
      3: [...ALL_YELLOW, ...ALL_WHITE],
      4: [...ALL_WHITE, ...ALL_BLUE],
      5: [GREEN, WHITE, WHITE, RED, ...ALL_BLUE],
      6: [...ALL_BLACK, ...ALL_BLACK],
      7: [PURPLE, PURPLE, PURPLE, PURPLE, ...ALL_YELLOW],
      8: [...ALL_BLUE, ...ALL_WHITE],
      9: [...ALL_RED, ...ALL_WHITE],
      10: [...ALL_YELLOW, ...ALL_BLACK],
      11: [...ALL_RED, ...ALL_BLACK],
      12: [...ALL_BLUE, ...ALL_BLACK],
      13: [...ALL_GREEN, ...ALL_BLACK],
      14: [...ALL_WHITE, ...ALL_BLACK],
      15: [...ALL_BLACK, ...ALL_WHITE],
      16: [...ALL_BLACK, ...ALL_RED],
      17: [...ALL_BLACK, ...ALL_BLUE],
      18: [...ALL_BLACK, ...ALL_GREEN],
      19: [...ALL_BLACK, BLUE, PINK, PINK, BLUE],
      20: [...ALL_BLACK, BLUE, RED, RED, BLUE],
      21: [...ALL_RED, ...ALL_BLUE],
      22: [...ALL_BLUE, ...ALL_RED],
      23: [...ALL_RED, ...ALL_GREEN],
      24: [...ALL_GREEN, ...ALL_RED],
      25: [...ALL_YELLOW, ...ALL_RED],
      26: [...ALL_BLUE, ...ALL_YELLOW],
      27: [...ALL_YELLOW, ...ALL_BLUE],
      28: [...ALL_BLUE, ...ALL_GREEN],
      29: [...ALL_GREEN, ...ALL_BLUE],
      30: [...ALL_YELLOW, ...ALL_GREEN],
      31: [...ALL_GREEN, ...ALL_YELLOW],
      32: [...ALL_BLUE, ...ALL_PINK],
      33: [...ALL_PINK, ...ALL_BLUE],
      34: [...ALL_YELLOW, ...ALL_PINK],
      35: [...ALL_PINK, ...ALL_YELLOW],
      36: [...ALL_WHITE, ...ALL_RED],
      37: [...ALL_WHITE, ...ALL_BLUE],
      38: [...ALL_WHITE, ...ALL_GREEN],
      39: [...ALL_WHITE, ...ALL_YELLOW],
      40: [...ALL_WHITE, ...ALL_PINK],
      41: [...ALL_RED, ...ALL_WHITE],
      42: [...ALL_BLUE, ...ALL_WHITE],
      43: [...ALL_GREEN, ...ALL_WHITE],
      44: [...ALL_YELLOW, ...ALL_WHITE],
      45: [...ALL_PINK, ...ALL_WHITE],
    };
  }

  getActiveColors(profile) {
    try {
      return this.profiles[profile].slice(4, 8);
    } catch (e) {
      return this.profiles.default.slice(4, 8);
    }
  }
  getIdleColors(profile) {
    try {
      return this.profiles[profile].slice(0, 4);
    } catch (e) {
      return this.profiles.default.slice(0, 4);
    }
  }
}

class DomUtil {
  getPSCB = () => {
    // https://github.com/PimpTrizkit/PJs/wiki/12.-Shade,-Blend-and-Convert-a-Web-Color-(pSBC.js)
    /* eslint-disable no-unused-expressions */
    // prettier-ignore
    const pSBC=(p,c0,c1,l)=>{
        let r,g,b,P,f,t,h,m=Math.round,a=typeof(c1)=="string";
        if(typeof(p)!="number"||p<-1||p>1||typeof(c0)!="string"||(c0[0]!='r'&&c0[0]!='#')||(c1&&!a))return null;
        h=c0.length>9,h=a?c1.length>9?true:c1=="c"?!h:false:h,f=pSBC.pSBCr(c0),P=p<0,t=c1&&c1!="c"?pSBC.pSBCr(c1):P?{r:0,g:0,b:0,a:-1}:{r:255,g:255,b:255,a:-1},p=P?p*-1:p,P=1-p;
        if(!f||!t)return null;
        if(l)r=m(P*f.r+p*t.r),g=m(P*f.g+p*t.g),b=m(P*f.b+p*t.b);
        else r=m((P*f.r**2+p*t.r**2)**0.5),g=m((P*f.g**2+p*t.g**2)**0.5),b=m((P*f.b**2+p*t.b**2)**0.5);
        a=f.a,t=t.a,f=a>=0||t>=0,a=f?a<0?t:t<0?a:a*P+t*p:0;
        if(h)return"rgb"+(f?"a(":"(")+r+","+g+","+b+(f?","+m(a*1000)/1000:"")+")";
        else return"#"+(4294967296+r*16777216+g*65536+b*256+(f?m(a*255):0)).toString(16).slice(1,f?undefined:-2)
    }
    // prettier-ignore
    pSBC.pSBCr=(d)=>{
        const i=parseInt;
        let n=d.length,x={};
        if(n>9){
            const [r, g, b, a] = (d = d.split(','));
                n = d.length;
            if(n<3||n>4)return null;
            x.r=i(r[3]=="a"?r.slice(5):r.slice(4)),x.g=i(g),x.b=i(b),x.a=a?parseFloat(a):-1
        }else{
            if(n==8||n==6||n<4)return null;
            if(n<6)d="#"+d[1]+d[1]+d[2]+d[2]+d[3]+d[3]+(n>4?d[4]+d[4]:"");
            d=i(d.slice(1),16);
            if(n==9||n==5)x.r=d>>24&255,x.g=d>>16&255,x.b=d>>8&255,x.a=Math.round((d&255)/0.255)/1000;
            else x.r=d>>16,x.g=d>>8&255,x.b=d&255,x.a=-1
        }
        return x
    };
    return pSBC;
  };

  getColorProfileManager() {
    return new ColorProfileManager();
  }
}

export default DomUtil;
