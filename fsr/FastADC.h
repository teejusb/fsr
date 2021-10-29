// defines for setting and clearing register bits
#ifndef cbi
  #define cbi(sfr, bit) (_SFR_BYTE(sfr) &= ~_BV(bit))
#endif
#ifndef sbi
  #define sbi(sfr, bit) (_SFR_BYTE(sfr) |= _BV(bit))
#endif

void SetFastADC()
{
  #if FASTADC
    // set prescale to 16. s == 1, x ==0 from prescale table.
    // 16 == 78000 hz, default is 128 which is 9600hz
    // https://github.com/teejusb/fsr/issues/26
    sbi(ADCSRA,ADPS2) ;
    cbi(ADCSRA,ADPS1) ;
    cbi(ADCSRA,ADPS0) ;
  #endif
}