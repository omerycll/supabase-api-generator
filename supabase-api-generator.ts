#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

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
function extractTableNames(): string[] {
  const fileContent = fs.readFileSync(TYPE_FILE_PATH, 'utf8');

  // Create a source file
  const sourceFile = ts.createSourceFile(
    'temp.ts',
    fileContent,
    ts.ScriptTarget.Latest,
    true
  );

  const tableNames: string[] = [];

  // Function to recursively visit nodes
  function visit(node: ts.Node) {
    if (
      ts.isPropertySignature(node) &&
      node.parent &&
      ts.isTypeLiteralNode(node.parent) &&
      node.parent.parent &&
      ts.isPropertySignature(node.parent.parent) &&
      node.parent.parent.name &&
      ts.isIdentifier(node.parent.parent.name) &&
      node.parent.parent.name.text === 'Tables' &&
      node.name &&
      ts.isIdentifier(node.name)
    ) {
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
function toCamelCase(str: string): string {
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
function toPascalCase(str: string): string {
  return str
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

/**
 * Generate method code for a table
 */
function generateMethodsForTable(tableName: string): string {
  const camelCaseName = toCamelCase(tableName);
  const pascalCaseName = toPascalCase(tableName);

  // Ensure proper singular and plural forms
  let singularPascalCase = pascalCaseName;
  let pluralPascalCase = pascalCaseName;

  // If the name ends with 's', handle pluralization correctly
  if (pascalCaseName.endsWith('s') && !pascalCaseName.endsWith('ss') && !pascalCaseName.endsWith('us') && !pascalCaseName.endsWith('is')) {
    singularPascalCase = pascalCaseName.slice(0, -1);
  } else {
    // If it doesn't end with 's', add it for plural
    pluralPascalCase = `${pascalCaseName}s`;
  }

  // Handle special case for UserType -> should be UserTypes for plural
  if (tableName === 'user_type') {
    singularPascalCase = 'UserType';
    pluralPascalCase = 'UserTypes';
  }

  return `
  // ${pascalCaseName}
  get${pluralPascalCase} = (options?: { select?: string, idField?: string, limit?: number, page?: number, filters?: Record<string, any> }) => this.getAll('${tableName}', options);
  get${singularPascalCase} = (id: string, options?: { select?: string, idField?: string }) => this.getById('${tableName}', id, options);
  create${singularPascalCase} = (data: Database['public']['Tables']['${tableName}']['Insert']) => this.create('${tableName}', data);
  createMany${pluralPascalCase} = (data: Database['public']['Tables']['${tableName}']['Insert'][]) => this.createMany('${tableName}', data);
  update${singularPascalCase} = (id: string, data: Database['public']['Tables']['${tableName}']['Update'], options?: { idField?: string }) => this.update('${tableName}', id, data, options);
  updateMany${pluralPascalCase} = (updates: Array<{ id: string, data: Database['public']['Tables']['${tableName}']['Update'] }>, options?: { idField?: string }) => this.updateMany('${tableName}', updates, options);
  delete${singularPascalCase} = (id: string, options?: { idField?: string }) => this.delete('${tableName}', id, options);`;
}

/**
 * Generate the template file if it doesn't exist
 */
function generateTemplateFile(): void {
  if (!fs.existsSync(TEMPLATE_FILE_PATH)) {
    const templateContent = `import { createClient } from './supabase';
import { Database } from '../types/supabase';
import { PostgrestError } from '@supabase/supabase-js';

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
   * Apply filters to a query
   * @param query - The query to apply filters to
   * @param filters - Object where keys are column names and values are values to filter by
   * @returns The query with filters applied
   */
  private applyFilters(query: any, filters?: Record<string, any>): any {
    if (!filters) return query;
    
    let filteredQuery = query;
    
    // Apply each filter
    Object.entries(filters).forEach(([column, value]) => {
      if (value === null) {
        filteredQuery = filteredQuery.is(column, null);
      } else if (Array.isArray(value)) {
        filteredQuery = filteredQuery.in(column, value);
      } else if (typeof value === 'object') {
        // Handle special operators
        if ('gt' in value) filteredQuery = filteredQuery.gt(column, value.gt);
        if ('gte' in value) filteredQuery = filteredQuery.gte(column, value.gte);
        if ('lt' in value) filteredQuery = filteredQuery.lt(column, value.lt);
        if ('lte' in value) filteredQuery = filteredQuery.lte(column, value.lte);
        if ('neq' in value) filteredQuery = filteredQuery.neq(column, value.neq);
        if ('like' in value) filteredQuery = filteredQuery.like(column, value.like);
        if ('ilike' in value) filteredQuery = filteredQuery.ilike(column, value.ilike);
        if ('is' in value) filteredQuery = filteredQuery.is(column, value.is);
      } else {
        filteredQuery = filteredQuery.eq(column, value);
      }
    });
    
    return filteredQuery;
  }
  
  /**
   * Get all records from a specific table
   * @param tableName - The name of the table
   * @param options - Additional options for the query
   * @returns Promise with all records
   */
  async getAll<
    T extends keyof Database['public']['Tables']
  >(tableName: T, options?: { 
    select?: string, 
    idField?: string,
    limit?: number,
    page?: number,
    filters?: Record<string, any>
  }): Promise<Database['public']['Tables'][T]['Row'][]> {
    try {
      let query = this.supabase.from(tableName).select(options?.select || '*');
      
      // Apply filters if provided
      if (options?.filters) {
        query = this.applyFilters(query, options.filters);
      }
      
      // Add pagination if needed
      if (options?.limit !== undefined) {
        const page = options.page || 0;
        const offset = page * options.limit;
        query = query.range(offset, offset + options.limit - 1);
      }
      
      const { data, error } = await query;
      
      if (error) {
        throw error;
      }
      
      // Explicitly cast through unknown to ensure type safety
      return (data || []) as unknown as Database['public']['Tables'][T]['Row'][];
    } catch (error) {
      console.error(\`Error in getAll for \${String(tableName)}:\`, error);
      throw error;
    }
  }
  
  /**
   * Get a record by ID from a specific table
   * @param tableName - The name of the table
   * @param id - The ID of the record
   * @param options - Additional options for the query
   * @returns Promise with the record
   */
  async getById<
    T extends keyof Database['public']['Tables']
  >(tableName: T, id: string | number, options?: { select?: string, idField?: string }): Promise<Database['public']['Tables'][T]['Row'] | null> {
    try {
      const idField = options?.idField || 'id';
      
      const { data, error } = await this.supabase
        .from(tableName)
        .select(options?.select || '*')
        .eq(idField, id)
        .single();
      
      if (error) {
        if (error.code === 'PGRST116') {
          return null; // Record not found
        }
        throw error;
      }
      
      // Explicitly cast through unknown to ensure type safety
      return data as unknown as Database['public']['Tables'][T]['Row'];
    } catch (error) {
      console.error(\`Error in getById for \${String(tableName)}:\`, error);
      throw error;
    }
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
    try {
      const { data: createdData, error } = await this.supabase
        .from(tableName)
        .insert(data)
        .select('*')
        .single();
      
      if (error) {
        throw error;
      }
      
      // Explicitly cast through unknown to ensure type safety
      return createdData as unknown as Database['public']['Tables'][T]['Row'];
    } catch (error) {
      console.error(\`Error in create for \${String(tableName)}:\`, error);
      throw error;
    }
  }
  
  /**
   * Create multiple records in a specific table
   * @param tableName - The name of the table
   * @param data - Array of data to insert
   * @returns Promise with the created records
   */
  async createMany<
    T extends keyof Database['public']['Tables']
  >(tableName: T, data: Database['public']['Tables'][T]['Insert'][]): Promise<Database['public']['Tables'][T]['Row'][]> {
    try {
      const { data: createdData, error } = await this.supabase
        .from(tableName)
        .insert(data)
        .select('*');
      
      if (error) {
        throw error;
      }
      
      // Explicitly cast through unknown to ensure type safety
      return (createdData || []) as unknown as Database['public']['Tables'][T]['Row'][];
    } catch (error) {
      console.error(\`Error in createMany for \${String(tableName)}:\`, error);
      throw error;
    }
  }
  
  /**
   * Update a record in a specific table
   * @param tableName - The name of the table
   * @param id - The ID of the record
   * @param data - The data to update
   * @param options - Additional options for the query
   * @returns Promise with the updated record
   */
  async update<
    T extends keyof Database['public']['Tables']
  >(tableName: T, id: string | number, data: Database['public']['Tables'][T]['Update'], options?: { idField?: string }): Promise<Database['public']['Tables'][T]['Row']> {
    try {
      const idField = options?.idField || 'id';
      
      const { data: updatedData, error } = await this.supabase
        .from(tableName)
        .update(data)
        .eq(idField, id)
        .select('*')
        .single();
      
      if (error) {
        throw error;
      }
      
      // Explicitly cast through unknown to ensure type safety
      return updatedData as unknown as Database['public']['Tables'][T]['Row'];
    } catch (error) {
      console.error(\`Error in update for \${String(tableName)}:\`, error);
      throw error;
    }
  }

  /**
   * Update multiple records in a specific table
   * @param tableName - The name of the table
   * @param updates - Array of objects with id and data to update
   * @param options - Additional options for the query
   * @returns Promise with the updated records
   */
  async updateMany<
    T extends keyof Database['public']['Tables']
  >(
    tableName: T, 
    updates: Array<{ 
      id: string | number, 
      data: Database['public']['Tables'][T]['Update'] 
    }>,
    options?: { idField?: string }
  ): Promise<Database['public']['Tables'][T]['Row'][]> {
    try {
      const idField = options?.idField || 'id';
      
      // We need to perform the updates one by one since Supabase doesn't support
      // updating multiple records with different values in a single query
      const updatedRecords: Database['public']['Tables'][T]['Row'][] = [];
      
      for (const update of updates) {
        const { data: updatedData, error } = await this.supabase
          .from(tableName)
          .update(update.data)
          .eq(idField, update.id)
          .select('*')
          .single();
        
        if (error) {
          throw error;
        }
        
        // Explicitly cast through unknown to ensure type safety
        updatedRecords.push(updatedData as unknown as Database['public']['Tables'][T]['Row']);
      }
      
      return updatedRecords;
    } catch (error) {
      console.error(\`Error in updateMany for \${String(tableName)}:\`, error);
      throw error;
    }
  }
  
  /**
   * Delete a record from a specific table
   * @param tableName - The name of the table
   * @param id - The ID of the record
   * @param options - Additional options for the query
   * @returns Promise with the deleted record
   */
  async delete<
    T extends keyof Database['public']['Tables']
  >(tableName: T, id: string | number, options?: { idField?: string }): Promise<void> {
    try {
      const idField = options?.idField || 'id';
      
      const { error } = await this.supabase
        .from(tableName)
        .delete()
        .eq(idField, id);
      
      if (error) {
        throw error;
      }
    } catch (error) {
      console.error(\`Error in delete for \${String(tableName)}:\`, error);
      throw error;
    }
  }
  
  // Generated CRUD methods for specific tables
  // [TABLE_METHODS]
}

// Create and export a singleton instance
export const API = new SupabaseApiGenerator();

// Export default as the singleton instance
export default API;`;

    fs.writeFileSync(TEMPLATE_FILE_PATH, templateContent);
    console.log(`Created template file at ${TEMPLATE_FILE_PATH}`);
  }
}

/**
 * Generate the API class with methods for all tables
 */
function generateApiClass(): void {
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

  // First, make sure the output directory exists
  const outputDir = path.dirname(OUTPUT_FILE_PATH);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`Created output directory at ${outputDir}`);
  }

  // Make sure we're deleting the existing file
  if (fs.existsSync(OUTPUT_FILE_PATH)) {
    try {
      // Try to forcefully delete the file
      fs.unlinkSync(OUTPUT_FILE_PATH);
      console.log(`Successfully deleted existing file at ${OUTPUT_FILE_PATH}`);
    } catch (error) {
      console.error(`Error deleting file at ${OUTPUT_FILE_PATH}:`, error);
    }
  }

  // A small delay to ensure file system has processed the delete
  setTimeout(() => {
    // Write the output file
    fs.writeFileSync(OUTPUT_FILE_PATH, outputContent);

    console.log(`Successfully generated SupabaseApiGenerator with methods for ${tableNames.length} tables!`);
    console.log('Tables:', tableNames.join(', '));
  }, 100);
}

// Run the generator
if (require.main === module) {
  generateApiClass();
}

export { generateApiClass }; 