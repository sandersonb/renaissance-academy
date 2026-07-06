declare module 'unix-crypt-td-js' {
  /** Traditional Unix DES crypt(3). `salt` may be the full stored hash; the
   *  first 2 chars are used as the salt. */
  const unixCrypt: (key: string, salt: string) => string;
  export default unixCrypt;
}
