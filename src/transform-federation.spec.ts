import { makeExecutableSchema, delegateToSchema } from 'graphql-tools';
import { transformSchemaFederation } from './transform-federation';
import { execute } from 'graphql/execution/execute';
import { DirectiveNode, parse, print, visit } from 'graphql/language';
import dedent = require('dedent');

describe('Transform Federation', () => {
  it('should add a _service field', async () => {
    const executableSchema = makeExecutableSchema({
      typeDefs: `
        type Product {
          id: ID!
        }
      `,
      resolvers: {},
    });

    const federationSchema = transformSchemaFederation(executableSchema, {
      Product: {
        keyFields: ['id'],
      },
    });

    expect(
      await execute({
        schema: federationSchema,
        document: parse(`
          query {
            _service {
              sdl
            }
          }
        `),
      }),
    ).toEqual({
      data: {
        _service: {
          sdl: dedent`
            type Product @key(fields: "id") {
              id: ID!
            }\n
          `,
        },
      },
    });
  });
  it('should resolve references', async () => {
    const executableSchema = makeExecutableSchema({
      typeDefs: `
    type Product {
      id: ID!
      name: String!
    }
      `,
      resolvers: {},
    });

    const federationSchema = transformSchemaFederation(executableSchema, {
      Product: {
        keyFields: ['id'],
        extend: true,
        resolveReference(reference) {
          return {
            ...reference,
            name: 'mock name',
          };
        },
      },
    });

    expect(
      await execute({
        schema: federationSchema,
        document: parse(`
          query{
            _entities (representations: {
              __typename:"Product"
              id: "1"
            }) {
              __typename
              ...on Product {
                id
                name
              }
            }
          } 
        `),
      }),
    ).toEqual({
      data: {
        _entities: [
          {
            __typename: 'Product',
            id: '1',
            name: 'mock name',
          },
        ],
      },
    });
  });

  it('should throw and error when adding resolveReference on a scalar', () => {
    const executableSchema = makeExecutableSchema({
      typeDefs: 'scalar MockScalar',
      resolvers: {},
    });

    expect(() =>
      transformSchemaFederation(executableSchema, {
        MockScalar: {
          resolveReference() {
            return {};
          },
        },
      }),
    ).toThrow(
      'Type "MockScalar" is not an object type and can\'t have a resolveReference function',
    );
  });
});


describe('Transform Federation stress', () => {
  it('should resolve references', async () => {
    const executableSchema = makeExecutableSchema({
      typeDefs: `
    type Product {
      id: ID!
      name: String!
    }

    type Query {
      productById(id: String!): Product!
    }
      `,
      resolvers: {
        Query: {
          productById(source, { id }) {
            return { id: '1', name: 'product1' };
          },
        },
      },
    });

    const federationSchema = transformSchemaFederation(executableSchema, {
      Product: {
        keyFields: ['id'],
        extend: true,
        resolveReference: async (
          reference: any,
          context: { [key: string]: any },
          info,
        ) => {
          const res = await delegateToSchema({
            schema: info.schema,
            operation: 'query',
            fieldName: 'productById',
            args: {
              id: reference.id,
            },
            context,
            info,
          });
          return res;
        },
      },
    });

    const result = await execute({
      schema: federationSchema,
      document: parse(`
          query{
            _entities (representations: {
              __typename:"Product"
              id: "1"
            }) {
              __typename
              ...on Product {
                id
                name
              }
            }
          } 
        `),
    });

    expect(result).toEqual({
      data: {
        _entities: [
          {
            __typename: 'Product',
            id: '1',
            name: 'product1',
          },
        ],
      },
    });
  });
});

