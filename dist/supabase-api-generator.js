#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateApiClass = generateApiClass;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ts = __importStar(require("typescript"));
/**
 * Supabase API Generator
 *
 * Automatically generates CRUD operations for Supabase tables based on TypeScript type definitions.
 */
// Parse command line arguments
const args = process.argv.slice(2);
const typeFilePath = args[0];
const outputFilePath = args[1];
if (!typeFilePath || !outputFilePath) {
    console.error('Usage: ts-node supabase-api-generator.ts <type-file-path> <output-file-path>');
    process.exit(1);
}
// Resolve file paths
const TYPE_FILE_PATH = path.resolve(process.cwd(), typeFilePath);
const OUTPUT_FILE_PATH = path.resolve(process.cwd(), outputFilePath);
const TEMPLATE_FILE_PATH = path.resolve(process.cwd(), path.dirname(outputFilePath), 'SupabaseApi.ts');
/**
 * Extract table names from the Database type definition
 */
function extractTableNames() {
    const fileContent = fs.readFileSync(TYPE_FILE_PATH, 'utf8');
    // Create a source file
    const sourceFile = ts.createSourceFile('temp.ts', fileContent, ts.ScriptTarget.Latest, true);
    const tableNames = [];
    // Function to recursively visit nodes
    function visit(node) {
        if (ts.isPropertySignature(node) &&
            node.parent &&
            ts.isTypeLiteralNode(node.parent) &&
            node.parent.parent &&
            ts.isPropertySignature(node.parent.parent) &&
            node.parent.parent.name &&
            ts.isIdentifier(node.parent.parent.name) &&
            node.parent.parent.name.text === 'Tables' &&
            node.name &&
            ts.isIdentifier(node.name)) {
            tableNames.push(node.name.text);
        }
        ts.forEachChild(node, visit);
    }
    // Start traversing
    visit(sourceFile);
    return tableNames;
}
/**
 * Convert a table name to a camel case method name
 */
function toCamelCase(str) {
    return str
        .split('_')
        .map((word, index) => {
        if (index === 0) {
            return word.toLowerCase();
        }
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
        .join('');
}
/**
 * Convert a table name to a pascal case type name
 */
function toPascalCase(str) {
    return str
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join('');
}
/**
 * Generate method code for a table
 */
function generateMethodsForTable(tableName) {
    const camelCaseName = toCamelCase(tableName);
    const pascalCaseName = toPascalCase(tableName);
    const singularPascalCase = pascalCaseName.endsWith('s')
        ? pascalCaseName.slice(0, -1)
        : pascalCaseName;
    // Çoğul form için her zaman sonuna 's' ekle, tekil form için 's' eklemeden kullan
    return `
  // ${pascalCaseName}
  get${pascalCaseName}s = () => this.getAll('${tableName}');
  get${singularPascalCase} = (id: string) => this.getById('${tableName}', id);
  create${singularPascalCase} = (data: Database['public']['Tables']['${tableName}']['Insert']) => this.create('${tableName}', data);
  update${singularPascalCase} = (id: string, data: Database['public']['Tables']['${tableName}']['Update']) => this.update('${tableName}', id, data);
  delete${singularPascalCase} = (id: string) => this.delete('${tableName}', id);`;
}
/**
 * Generate the template file if it doesn't exist
 */
function generateTemplateFile() {
    if (!fs.existsSync(TEMPLATE_FILE_PATH)) {
        const templateContent = `import { createClient } from './supabase';
import { Database } from '../types/supabase';

/**
 * SupabaseApiGenerator - Generates CRUD operations for database tables
 * 
 * This class automatically creates CRUD operations for tables defined in the 
 * Database type interface. It provides methods to get, create, update, and delete
 * records for each table.
 */
export class SupabaseApiGenerator {
  private supabase = createClient();
  
  /**
   * Get all records from a specific table
   * @param tableName - The name of the table
   * @returns Promise with all records
   */
  async getAll<
    T extends keyof Database['public']['Tables']
  >(tableName: T): Promise<Database['public']['Tables'][T]['Row'][]> {
    const { data, error } = await this.supabase
      .from(tableName)
      .select('*');
    
    if (error) {
      throw error;
    }
    
    return data;
  }
  
  /**
   * Get a record by ID from a specific table
   * @param tableName - The name of the table
   * @param id - The ID of the record
   * @returns Promise with the record
   */
  async getById<
    T extends keyof Database['public']['Tables']
  >(tableName: T, id: string | number): Promise<Database['public']['Tables'][T]['Row'] | null> {
    const { data, error } = await this.supabase
      .from(tableName)
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        return null; // Record not found
      }
      throw error;
    }
    
    return data;
  }
  
  /**
   * Create a new record in a specific table
   * @param tableName - The name of the table
   * @param data - The data to insert
   * @returns Promise with the created record
   */
  async create<
    T extends keyof Database['public']['Tables']
  >(tableName: T, data: Database['public']['Tables'][T]['Insert']): Promise<Database['public']['Tables'][T]['Row']> {
    const { data: createdData, error } = await this.supabase
      .from(tableName)
      .insert(data)
      .select('*')
      .single();
    
    if (error) {
      throw error;
    }
    
    return createdData;
  }
  
  /**
   * Update a record in a specific table
   * @param tableName - The name of the table
   * @param id - The ID of the record
   * @param data - The data to update
   * @returns Promise with the updated record
   */
  async update<
    T extends keyof Database['public']['Tables']
  >(tableName: T, id: string | number, data: Database['public']['Tables'][T]['Update']): Promise<Database['public']['Tables'][T]['Row']> {
    const { data: updatedData, error } = await this.supabase
      .from(tableName)
      .update(data)
      .eq('id', id)
      .select('*')
      .single();
    
    if (error) {
      throw error;
    }
    
    return updatedData;
  }
  
  /**
   * Delete a record from a specific table
   * @param tableName - The name of the table
   * @param id - The ID of the record
   * @returns Promise with the deleted record
   */
  async delete<
    T extends keyof Database['public']['Tables']
  >(tableName: T, id: string | number): Promise<void> {
    const { error } = await this.supabase
      .from(tableName)
      .delete()
      .eq('id', id);
    
    if (error) {
      throw error;
    }
  }
  
  /**
   * Get records by a specific column value
   * @param tableName - The name of the table
   * @param column - The column to filter by
   * @param value - The value to filter for
   * @returns Promise with the records
   */
  async getByColumn<
    T extends keyof Database['public']['Tables']
  >(tableName: T, column: keyof Database['public']['Tables'][T]['Row'], value: any): Promise<Database['public']['Tables'][T]['Row'][]> {
    const { data, error } = await this.supabase
      .from(tableName)
      .select('*')
      .eq(column as string, value);
    
    if (error) {
      throw error;
    }
    
    return data;
  }
  
  // Generated CRUD methods for specific tables
  // [TABLE_METHODS]
}

/**
 * Create a new instance of SupabaseApiGenerator
 * @returns New SupabaseApiGenerator instance
 */
export const createSupabaseApi = (): SupabaseApiGenerator => {
  return new SupabaseApiGenerator();
};

export default createSupabaseApi;`;
        fs.writeFileSync(TEMPLATE_FILE_PATH, templateContent);
        console.log(`Created template file at ${TEMPLATE_FILE_PATH}`);
    }
}
/**
 * Generate the API class with methods for all tables
 */
function generateApiClass() {
    // Generate template file if it doesn't exist
    generateTemplateFile();
    // Extract table names from the type file
    const tableNames = extractTableNames();
    // Generate methods for each table
    const tableMethods = tableNames
        .map(tableName => generateMethodsForTable(tableName))
        .join('\n');
    // Read the template file
    const templateContent = fs.readFileSync(TEMPLATE_FILE_PATH, 'utf8');
    // Replace the placeholder with the generated methods
    const outputContent = templateContent.replace('// [TABLE_METHODS]', tableMethods);
    // Write the output file
    fs.writeFileSync(OUTPUT_FILE_PATH, outputContent);
    console.log(`Successfully generated SupabaseApiGenerator with methods for ${tableNames.length} tables!`);
    console.log('Tables:', tableNames.join(', '));
}
// Run the generator
if (require.main === module) {
    generateApiClass();
}
