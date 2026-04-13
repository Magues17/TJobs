# TarboroJobs.com

TarboroJobs.com is a local job board and employer portal built for Tarboro, North Carolina. It is designed to help local businesses post jobs, manage applicants, and connect with job seekers in the area through a focused, community-based hiring platform.

This project includes:

- a public-facing job board
- an employer onboarding and login system
- employer job management
- employer applicant tracking
- resume/application submission
- admin-controlled employer activation and onboarding token flows

---

## Overview

TarboroJobs.com is intended to be a scalable local hiring platform that starts with Tarboro and can later be adapted into additional city-based job sites using the same core codebase.

The platform supports three main user groups:

### 1. Job seekers
Job seekers can browse open jobs and apply to specific job postings.

### 2. Employers
Employers can:

- complete onboarding
- log in to a private dashboard
- create and manage job posts
- review applicants for their own jobs only
- track candidate actions such as saved, contacted, interviewing, hired, and rejected

### 3. Admin
Admin can:

- create employer onboarding tokens
- deactivate employers
- reactivate employers
- revoke onboarding tokens

---

## Core Business Rule

Employers must only be able to view resumes/applications submitted for their own job postings.

This project enforces that by tying each application record to a specific `job_post_id`, then restricting employer resume visibility through ownership of the related `job_posts` record.

---

## Tech Stack

### Frontend
- React
- Vite
- Tailwind CSS

### Backend
- Node.js
- Express

### Database
- MySQL / MariaDB

### Authentication / Security
- JWT for employer auth
- bcrypt for password hashing
- token-based onboarding and password reset flows

### File Uploads
- multer for PDF resume uploads

### Email
- nodemailer for onboarding and password reset email delivery

### Hosting / Deployment
- Hostinger
- GitHub-based staging and production deployments

---

## Project Goals

- provide a clean local hiring platform for Tarboro
- give employers a simple way to manage job listings and applicants
- avoid the clutter of large national job boards
- create a repeatable system that can later be expanded into additional local job board brands

---

## Main Features

### Public side
- browse open job listings
- view active employers/businesses
- apply to open jobs
- upload PDF resumes

### Employer side
- employer onboarding with token-based access
- employer authentication
- create, edit, close, and delete job posts
- view only applicants tied to the employer’s own jobs
- manage candidate statuses and follow-up notes
- view dashboard stats

### Admin side
- issue onboarding tokens
- send onboarding emails
- deactivate employers and close open jobs
- reactivate employers
- revoke onboarding tokens

---

## Resume / Application Model

This project originally treated resumes more like a general resume bank.

It now uses a job-specific application model:

- each application is stored in `job_seekers`
- each row is tied to a `job_post_id`
- employer resume visibility is filtered through `job_posts.employer_id`

This means:

- Employer A only sees applications for Employer A’s jobs
- Employer B only sees applications for Employer B’s jobs
- employers cannot browse a global pool of all resumes

---

## High-Level Database Tables

### `employers`
Stores employer/company records.

### `employer_users`
Stores employer login credentials.

### `employer_onboarding_tokens`
Stores onboarding tokens used to activate and complete employer setup.

### `employer_password_reset_tokens`
Stores password reset tokens for employer users.

### `job_posts`
Stores employer-created job listings.

### `job_seekers`
Stores submitted applications/resumes tied to a specific `job_post_id`.

### `employer_candidate_actions`
Stores employer-side tracking data for candidates, such as status, notes, interview date, and follow-up date.

---

