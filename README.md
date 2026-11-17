# Examurai

Examurai is a student question-paper library with a responsive web interface and an Express API for searching, downloading, bookmarking, and contributing papers.

## Run locally

1. Install Node.js 18 or later and MySQL 8.
2. Create a database and tables for `users`, `papers`, and `bookmarks`. The current server expects the existing schema, including the paper fields used by `server.js`.
3. Copy `.env.example` to `.env` and set the database and admin credentials.
4. Run `npm install`, then `npm start`.
5. Open `http://localhost:3000`.

The paper library lists approved records from the configured database. Uploaded PDFs are limited to 20 MB and stored in `uploads/`.

## Current implementation

- Responsive HTML, CSS, and JavaScript interface.
- Express REST API with MySQL queries and session authentication.
- Subject, branch, college, and text search with pagination.
- PDF upload and authenticated download routes.

The current codebase uses MySQL and cookie sessions. It does not currently use React, MongoDB, or JWT. Set up the database schema before using authenticated features.
