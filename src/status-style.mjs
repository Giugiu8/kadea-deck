// Shared visual contract for our Claude cards and the explicitly labelled mock.
export const statusStyles=Object.freeze({
 working:{color:'#59b5ff',surface:'#0d243b',label:'WORKING',icon:'spinner'},
 attention:{color:'#ffd34e',surface:'#33290e',label:'INPUT',icon:'question'},
 unread:{color:'#4de398',surface:'#0c3022',label:'NEW',icon:'check'},
 error:{color:'#ff6b7d',surface:'#38151e',label:'ERROR',icon:'warning'},
 idle:{color:'#bcc6d8',surface:'#121923',label:'READY',icon:'chats'},
 unknown:{color:'#8792a5',surface:'#111620',label:'UNKNOWN',icon:'linkoff'},
 empty:{color:'#566176',surface:'#0d1118',label:'EMPTY',icon:'plus'},
});
