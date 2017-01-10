import { CompiledProgram, CompiledBlock } from './compiled/blocks';
import { builder } from './compiler';
import OpcodeBuilder from './compiled/opcodes/builder';
import Environment from './environment';
import { Option } from 'glimmer-util';
import { EMPTY_ARRAY } from './utils';
import { SerializedTemplateBlock, TemplateMeta, SerializedBlock, Statement as SerializedStatement } from 'glimmer-wire-format';
import * as WireFormat from 'glimmer-wire-format';
import { entryPoint as entryPointTable, layout as layoutTable, block as blockTable } from './symbol-table';
import { Opaque, SymbolTable, ProgramSymbolTable } from 'glimmer-interfaces';

import {
  STATEMENTS
} from './syntax/functions';

import {
  SPECIALIZE
} from './syntax/specialize';

export type DeserializedStatement = WireFormat.Statement | WireFormat.Statements.Attribute | WireFormat.Statements.Argument;

export function compileStatement(statement: BaselineSyntax.AnyStatement, builder: OpcodeBuilder) {
  let refined = SPECIALIZE.specialize(statement, builder.symbolTable);
  STATEMENTS.compile(refined, builder);
}

export abstract class Template {
  constructor(public symbolTable: SymbolTable) {}

  abstract compile(env: Environment): CompiledBlock;
}

function compileStatements(statements: BaselineSyntax.AnyStatement[], env: Environment, table: SymbolTable) {
  let b = builder(env, table);
  for (let statement of statements) {
    let refined = SPECIALIZE.specialize(statement, table);
    STATEMENTS.compile(refined, b);
  }

  return b;
}

export class EntryPoint extends Template {
  public symbolTable: ProgramSymbolTable;

  constructor(public statements: BaselineSyntax.AnyStatement[], symbolTable: ProgramSymbolTable) {
    super(symbolTable);
  }

  compile(env: Environment): CompiledProgram {
    let builder = compileStatements(this.statements, env, this.symbolTable);
    return new CompiledProgram(builder.toSlice(), this.symbolTable.size);
  }
}

export class Layout extends EntryPoint {
  public symbolTable: ProgramSymbolTable;

  constructor(prelude: BaselineSyntax.AnyStatement[], body: BaselineSyntax.AnyStatement[], symbolTable: ProgramSymbolTable) {
    let statements = prelude.concat([['yield', '%attrs%', EMPTY_ARRAY], ['flush-element']]).concat(body);
    super(statements, symbolTable);
  }
}

export class InlineBlock extends Template {
  private block: Option<CompiledBlock> = null;

  constructor(public statements: BaselineSyntax.AnyStatement[], symbolTable: SymbolTable) {
    super(symbolTable);
  }

  splat(builder: OpcodeBuilder) {
    let table = builder.symbolTable;

    for (let statement of this.statements) {
      let refined = SPECIALIZE.specialize(statement, table);
      STATEMENTS.compile(refined, builder);
    }
  }

  compile(env: Environment): CompiledBlock {
    let block = this.block;

    if (!block) {
      let b = compileStatements(this.statements, env, this.symbolTable);
      block = this.block = new CompiledBlock(b.toSlice());
    }

    return block;
  }

  toJSON() {
    return { GlimmerDebug: '<block>' };
  }
}

export default class Scanner {
  constructor(private block: SerializedTemplateBlock, private meta: TemplateMeta, private env: Environment) {
  }

  scanEntryPoint(): EntryPoint {
    let { block, meta } = this;

    let statements;
    if (block.prelude) {
      statements = block.prelude.concat([['flush-element']]).concat(block.statements);
    } else {
      statements = block.statements;
    }

    let symbolTable = entryPointTable(meta);
    let child = scanBlock(statements, symbolTable, this.env);
    return new EntryPoint(child.statements, symbolTable);
  }

  scanLayout(): Layout {
    let { block, meta } = this;
    let { named, yields, hasPartials } = block;

    let symbolTable = layoutTable(meta, named, yields, hasPartials);
    let { statements: prelude } = scanBlock(block.prelude, symbolTable, this.env);
    let { statements: body } = scanBlock(block.statements, symbolTable, this.env);

    return new Layout(prelude, body, symbolTable);
  }

  scanPartial(symbolTable: SymbolTable): EntryPoint {
    let { block } = this;

    let child = scanBlock(block.statements, symbolTable, this.env);

    return new EntryPoint(child.statements, symbolTable);
  }
}

export function scanBlock(statements: WireFormat.Statement[], symbolTable: SymbolTable, env: Environment): InlineBlock {
  return new RawInlineBlock(env, symbolTable, statements).scan();
}

import { PublicVM } from './vm';
import { VersionedPathReference } from 'glimmer-reference';

export namespace BaselineSyntax {
  import Core = WireFormat.Core;

  // TODO: use symbols for sexp[0]?
  export type ScannedComponent = ['scanned-component', string, RawInlineBlock, WireFormat.Core.Hash, Option<RawInlineBlock>];
  export const isScannedComponent = WireFormat.is<ScannedComponent>('scanned-component');

  import Params = WireFormat.Core.Params;
  import Hash = WireFormat.Core.Hash;
  export type Block = InlineBlock;

  export type OpenPrimitiveElement = ['open-primitive-element', string, string[]];
  export const isPrimitiveElement = WireFormat.is<OpenPrimitiveElement>('open-primitive-element');

  export type OptimizedAppend = ['optimized-append', WireFormat.Expression, boolean];
  export const isOptimizedAppend = WireFormat.is<OptimizedAppend>('optimized-append');

  export type UnoptimizedAppend = ['unoptimized-append', WireFormat.Expression, boolean];
  export const isUnoptimizedAppend = WireFormat.is<UnoptimizedAppend>('unoptimized-append');

  export type AnyDynamicAttr = ['any-dynamic-attr', string, WireFormat.Expression, Option<string>, boolean];
  export const isAnyAttr = WireFormat.is<AnyDynamicAttr>('any-dynamic-attr');

  export type StaticPartial = ['static-partial', string];
  export const isStaticPartial = WireFormat.is<StaticPartial>('static-partial');
  export type DynamicPartial = ['dynamic-partial', WireFormat.Expression];
  export const isDynamicPartial = WireFormat.is<DynamicPartial>('dynamic-partial');

  export type FunctionExpressionCallback<T> = (VM: PublicVM, symbolTable: SymbolTable) => VersionedPathReference<T>;
  export type FunctionExpression = ['function', FunctionExpressionCallback<Opaque>];
  export const isFunctionExpression = WireFormat.is<FunctionExpression>('function');

  export type NestedBlock = ['nested-block', WireFormat.Core.Path, WireFormat.Core.Params, WireFormat.Core.Hash, Option<Block>, Option<Block>];
  export const isNestedBlock = WireFormat.is<NestedBlock>('nested-block');

  export type ScannedBlock = ['scanned-block', Core.Path, Core.Params, Core.Hash, Option<RawInlineBlock>, Option<RawInlineBlock>];
  export const isScannedBlock = WireFormat.is<ScannedBlock>('scanned-block');

  export type Args = [Params, Hash, Option<Block>, Option<Block>];

  export namespace NestedBlock {
    export function defaultBlock(sexp: NestedBlock): Option<InlineBlock> {
      return sexp[4];
    }

    export function inverseBlock(sexp: NestedBlock): Option<InlineBlock> {
      return sexp[5];
    }

    export function params(sexp: NestedBlock): WireFormat.Core.Params {
      return sexp[2];
    }

    export function hash(sexp: NestedBlock): WireFormat.Core.Hash {
      return sexp[3];
    }
  }

  export type Statement =
      ScannedComponent
    | OpenPrimitiveElement
    | OptimizedAppend
    | UnoptimizedAppend
    | StaticPartial
    | DynamicPartial
    | AnyDynamicAttr
    | NestedBlock
    | ScannedBlock
    ;

  export type AnyStatement = Statement | WireFormat.Statement;
  export type AnyExpression = FunctionExpression | WireFormat.Expression;

  export type Program = AnyStatement[];
}

export class RawInlineBlock {
  constructor(private env: Environment, private table: SymbolTable, private statements: SerializedStatement[]) {}

  scan(): InlineBlock {
    let buffer: BaselineSyntax.AnyStatement[] = [];
    let statements = this.statements;

    for (let statement of statements) {
      if (WireFormat.Statements.isBlock(statement)) {
        buffer.push(this.specializeBlock(statement));
      } else if (WireFormat.Statements.isComponent(statement)) {
        buffer.push(...this.specializeComponent(statement));
      } else {
        buffer.push(statement);
      }
    }

    return new InlineBlock(buffer, this.table);
  }

  private specializeBlock(block: WireFormat.Statements.Block): BaselineSyntax.ScannedBlock {
    let [, path, params, hash, template, inverse] = block;
    return ['scanned-block', path, params, hash, this.child(template), this.child(inverse)];
  }

  private specializeComponent(sexp: WireFormat.Statements.Component): BaselineSyntax.AnyStatement[] {
    let [, tag, component] = sexp;

    if (this.env.hasComponentDefinition([tag], this.table)) {
      let child = this.child(component);
      let attrs = new RawInlineBlock(this.env, this.table, component.attrs);
      return [['scanned-component', tag, attrs, component.args, child]];
    } else {
      return [
        ['open-element', tag, EMPTY_ARRAY],
        ...component.attrs,
        ['flush-element'],
        ...component.statements,
        ['close-element']
      ];
    }
  }

  child(block: Option<SerializedBlock>): Option<RawInlineBlock> {
    if (!block) return null;
    let table = blockTable(this.table, block.locals);
    return new RawInlineBlock(this.env, table, block.statements);
  }
}
