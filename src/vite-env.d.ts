// CSS Module 型別宣告，讓 TypeScript 認識 *.module.css 匯入
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
