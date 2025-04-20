/**
 * Base class for all database errors.
 * 
 * This class extends the built-in Error class and provides additional properties
 * and methods for handling errors in the database context.
 */
export class DatabaseError extends Error {
  public readonly cause?: Error;

  constructor(message: string, cause?: Error){
    super(message);
    this.name = this.constructor.name;
    this.cause = cause;

    // Capture the stack trace for this error instance.
    // In V8 environments (Node.js, Chrome), `Error.captureStackTrace` provides a way
    // to customize the stack trace. By passing `this.constructor` as the second
    // argument, we instruct it to omit the frames associated with the error's own
    // constructor call and any functions called internally during its setup.
    // This results in a cleaner stack trace that points directly to the location
    // in the application code where the error was created, rather than including
    // the internal implementation details of the error class itself.
    if (Error.captureStackTrace){
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error class for representing a resource that was not found.
 * 
 * This error extends the `DatabaseError` class and is used to indicate that a
 * requested resource (e.g., a file, directory, or database record) does not exist.
 * 
 * @extends DatabaseError
 */
export class NotFoundError extends DatabaseError {
  public readonly entityName: string;
  public readonly identifier: string | number;

  constructor(entityName: string, identifier: string | number, cause?: Error) {
    super(`${entityName} with identifier ${identifier} not found`, cause);
    this.entityName = entityName;
    this.identifier = identifier;
  }
}


/**
 * Error thrown for general query execution failures
 * 
 * This error extends the `DatabaseError` class and is used to indicate that a
 * query execution failed due to an unexpected error or issue.
 * 
 * @extends DatabaseError
 */
export class QueryExecutionError extends DatabaseError {
  public readonly query?: string;
  
  constructor(message: string, cause?: Error, query?: string){
    super(message, cause);
    this.query = query;
  }
}

/** 
 * Error class for representing a conflict in the database
 * 
 * This error extends the `DatabaseError` class and is used to indicate that a
 * conflict occurred in the database, such as a duplicate entry or a violation
 * of a unique constraint.
 * 
 * @extends DatabaseError 
 */
export class ConflictError extends DatabaseError {
  public readonly entityName: string;
  public readonly identifier: string | number;

  constructor(entityName: string, identifier: string | number, cause?: Error) {
    super(`${entityName} with identifier ${identifier} already exists`, cause);
    this.entityName = entityName;
    this.identifier = identifier;
  }
}

