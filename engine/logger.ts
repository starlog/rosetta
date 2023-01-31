import log4js from 'log4js';

//--------------------------------------------------------------------------------------------------
// log4js 설정
//--------------------------------------------------------------------------------------------------
log4js.configure({
  appenders: {
    out: { type: 'stdout', layout: { type: 'messagePassThrough' } },
    basic: { type: 'stdout', layout: { type: 'basic' } },
  },
  categories: {
    default: { appenders: ['out'], level: 'debug' },
  },
});

export function getLogger(logger){
  return log4js.getLogger(logger);
}
