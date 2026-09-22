# DevTask
DevTask is a collaborative project and task management application.
## Actors
Project Owners manage projects and invite members. Team Members work on assigned tasks.
## Authentication
Users must register and sign in with email and password.
Registration requires an email address.
Registration requires a password.
Registered users can sign in.
## Projects
Project Owners must be able to create and rename projects.
## Tasks
Team Members must be able to create tasks and update task status.
## Security
Passwords must be stored as salted hashes. All authenticated requests must use HTTPS.
## Performance
Task lists must load within 500 ms for up to 100 tasks.
## Technical constraints
The backend must use NestJS and PostgreSQL.
## Out of scope
A mobile application is out of scope for V1.
## Invitations
Project Owners can invite Team Members. The invitation expiry duration is unspecified.

## Operational qualities
Unexpected failures should be logged with sufficient diagnostic context.
Health endpoints should allow infrastructure to determine whether the application is running and ready to serve requests.
## Implementation boundaries
The backend should use Node.js, TypeScript, NestJS, PostgreSQL and Prisma.
The frontend should use React and TypeScript.
The application must support Docker containerization.
