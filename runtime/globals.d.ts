// What the browser scripts share through the page, for the typecheck: the globals one
// script sets and another reads, and the modules the CETEIcean page inlines as globals
// (typechecked as modules themselves; CETEIcean hangs DOM nodes on their trees).
interface Window { TeiFacsimile: any; TeiIslands: any }
declare const teiXpath: any;
declare const teiPm: any;
