/** 读者（这本手账要送给的那个人）在界面上的称呼：「仅她可见」「她的专属入口」……
 *  在 .env.local 里设 NEXT_PUBLIC_READER_NAME 换成对方的昵称；
 *  NEXT_PUBLIC_ 变量在构建时写进页面，改了要重新 build */
const fromEnv = process.env.NEXT_PUBLIC_READER_NAME;

export const READER_NAME = fromEnv && fromEnv.trim() ? fromEnv.trim() : "她";
