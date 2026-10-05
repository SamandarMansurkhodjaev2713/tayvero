export function mappingEntries(fields: Record<string,string>): Array<{source:string;target:string}>;
export function canRunMigration(input:{configured?:boolean;executionEnabled?:boolean;status?:string;running?:boolean}):boolean;
export function progressOf(report: {totalRows:number;created:number;duplicates:number;rejected:number}|undefined):{processed:number;total:number;percent:number};
export function validateMappingSelection(schema:Array<{key:string;required:boolean}>|undefined,selection:Record<string,string>):boolean;
