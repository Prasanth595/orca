const DOCUMENT_FIELDS = `
  id slugId title url content updatedAt
  project { id }
  issue { id identifier url }
`

export const DOCUMENT_CONTENT_QUERY = `
  query OrcaAgentLinearDocument($id: String!) {
    document(id: $id) { ${DOCUMENT_FIELDS} }
  }
`

export const PROJECT_CONTENT_QUERY = `
  query OrcaAgentLinearProjectContent($id: String!, $full: Boolean!, $first: Int!, $after: String) {
    project(id: $id) {
      id name url description content updatedAt
      documents(first: $first, after: $after) @include(if: $full) {
        nodes { ${DOCUMENT_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`
