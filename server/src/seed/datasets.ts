/**
 * SQL sandbox datasets (§4).
 *
 * Each dataset is rebuilt in a fresh in-memory database for every execution and
 * switched to read-only before a student's query runs. Keep them small: they
 * are re-created thousands of times a day.
 */

export interface DatasetSeed {
  slug: string;
  name: string;
  dialect: string;
  description: string;
  schemaSql: string;
  seedSql: string;
}

export const DATASETS: DatasetSeed[] = [
  {
    slug: 'company',
    name: 'Company HR',
    dialect: 'mysql',
    description: 'Employees, Departments, Projects and Assignments — the standard JOIN practice schema.',
    schemaSql: `
CREATE TABLE Departments (
  department_id   INTEGER PRIMARY KEY,
  department_name TEXT NOT NULL,
  location        TEXT
);

CREATE TABLE Employees (
  employee_id   INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT,
  salary        INTEGER NOT NULL,
  hire_date     TEXT,
  job_title     TEXT,
  manager_id    INTEGER,
  department_id INTEGER,
  FOREIGN KEY (department_id) REFERENCES Departments(department_id),
  FOREIGN KEY (manager_id) REFERENCES Employees(employee_id)
);

CREATE TABLE Projects (
  project_id    INTEGER PRIMARY KEY,
  project_name  TEXT NOT NULL,
  budget        INTEGER,
  department_id INTEGER,
  FOREIGN KEY (department_id) REFERENCES Departments(department_id)
);

CREATE TABLE Assignments (
  assignment_id INTEGER PRIMARY KEY,
  employee_id   INTEGER NOT NULL,
  project_id    INTEGER NOT NULL,
  hours         INTEGER NOT NULL,
  FOREIGN KEY (employee_id) REFERENCES Employees(employee_id),
  FOREIGN KEY (project_id) REFERENCES Projects(project_id)
);
`.trim(),
    seedSql: `
INSERT INTO Departments (department_id, department_name, location) VALUES
  (1, 'Engineering', 'Bengaluru'),
  (2, 'Sales',       'Mumbai'),
  (3, 'Marketing',   'Delhi'),
  (4, 'Finance',     'Pune'),
  (5, 'Research',    'Hyderabad');

INSERT INTO Employees (employee_id, name, email, salary, hire_date, job_title, manager_id, department_id) VALUES
  (1,  'Anita Sharma',  'anita@example.com',  95000, '2018-03-12', 'Engineering Manager', NULL, 1),
  (2,  'Rahul Verma',   'rahul@example.com',  72000, '2019-07-01', 'Software Engineer',    1,   1),
  (3,  'Priya Nair',    'priya@example.com',  68000, '2020-01-20', 'Software Engineer',    1,   1),
  (4,  'Vikram Singh',  'vikram@example.com', 54000, '2021-06-15', 'QA Engineer',          1,   1),
  (5,  'Neha Gupta',    'neha@example.com',   88000, '2017-11-05', 'Sales Manager',        NULL, 2),
  (6,  'Arjun Mehta',   'arjun@example.com',  61000, '2020-09-14', 'Sales Executive',      5,   2),
  (7,  'Divya Rao',     'divya@example.com',  47000, '2022-02-01', 'Sales Executive',      5,   2),
  (8,  'Karan Patel',   'karan@example.com',  59000, '2019-04-22', 'Marketing Lead',       NULL, 3),
  (9,  'Sneha Iyer',    'sneha@example.com',  43000, '2022-08-08', 'Content Writer',       8,   3),
  (10, 'Manish Kumar',  'manish@example.com', 76000, '2016-05-30', 'Accountant',           NULL, 4),
  (11, 'Ritu Desai',    'ritu@example.com',   52000, '2023-01-09', 'Analyst',              10,  4),
  (12, 'Sameer Khan',   'sameer@example.com', 67000, '2021-10-18', 'Consultant',           NULL, NULL);

INSERT INTO Projects (project_id, project_name, budget, department_id) VALUES
  (1, 'Payment Gateway',  500000, 1),
  (2, 'Mobile App',       350000, 1),
  (3, 'Lead Tracker',     180000, 2),
  (4, 'Brand Refresh',    120000, 3),
  (5, 'Audit Automation', 90000,  4),
  (6, 'Skunkworks',       40000,  NULL);

INSERT INTO Assignments (assignment_id, employee_id, project_id, hours) VALUES
  (1,  2, 1, 120),
  (2,  3, 1, 90),
  (3,  2, 2, 40),
  (4,  4, 2, 60),
  (5,  6, 3, 75),
  (6,  7, 3, 55),
  (7,  9, 4, 30),
  (8,  11, 5, 45),
  (9,  1, 1, 20),
  (10, 3, 2, 25);
`.trim(),
  },
  {
    slug: 'store',
    name: 'Online Store',
    dialect: 'mysql',
    description: 'Customers, Orders, Products and OrderItems for filtering and aggregation practice.',
    schemaSql: `
CREATE TABLE Customers (
  customer_id INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  city        TEXT,
  country     TEXT,
  signup_date TEXT
);

CREATE TABLE Products (
  product_id   INTEGER PRIMARY KEY,
  product_name TEXT NOT NULL,
  category     TEXT NOT NULL,
  price        REAL NOT NULL,
  stock        INTEGER NOT NULL
);

CREATE TABLE Orders (
  order_id    INTEGER PRIMARY KEY,
  customer_id INTEGER,
  order_date  TEXT NOT NULL,
  status      TEXT NOT NULL,
  total       REAL NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES Customers(customer_id)
);

CREATE TABLE OrderItems (
  order_item_id INTEGER PRIMARY KEY,
  order_id      INTEGER NOT NULL,
  product_id    INTEGER NOT NULL,
  quantity      INTEGER NOT NULL,
  unit_price    REAL NOT NULL,
  FOREIGN KEY (order_id) REFERENCES Orders(order_id),
  FOREIGN KEY (product_id) REFERENCES Products(product_id)
);
`.trim(),
    seedSql: `
INSERT INTO Customers (customer_id, name, city, country, signup_date) VALUES
  (1, 'Aisha Khan',    'Mumbai',    'India',  '2022-01-15'),
  (2, 'Ben Carter',    'London',    'UK',     '2021-11-02'),
  (3, 'Chen Wei',      'Singapore', 'SG',     '2023-03-19'),
  (4, 'Dana Lopez',    'Madrid',    'Spain',  '2022-07-30'),
  (5, 'Emeka Obi',     'Lagos',     'Nigeria','2023-05-11'),
  (6, 'Farah Ahmed',   'Dubai',     'UAE',    '2020-09-25');

INSERT INTO Products (product_id, product_name, category, price, stock) VALUES
  (1, 'Mechanical Keyboard', 'Electronics', 89.99,  40),
  (2, 'Noise Cancelling Headphones', 'Electronics', 199.50, 15),
  (3, 'Standing Desk',       'Furniture',   349.00, 8),
  (4, 'Ergonomic Chair',     'Furniture',   259.00, 12),
  (5, 'USB-C Hub',           'Electronics', 45.00,  100),
  (6, 'Desk Lamp',           'Furniture',   32.50,  60),
  (7, 'Notebook Pack',       'Stationery',  12.00,  200);

INSERT INTO Orders (order_id, customer_id, order_date, status, total) VALUES
  (1, 1, '2023-06-01', 'delivered', 289.49),
  (2, 1, '2023-07-14', 'delivered', 45.00),
  (3, 2, '2023-06-22', 'shipped',   349.00),
  (4, 3, '2023-08-03', 'pending',   211.50),
  (5, 4, '2023-08-19', 'delivered', 32.50),
  (6, 2, '2023-09-05', 'cancelled', 89.99),
  (7, NULL, '2023-09-20', 'pending', 12.00);

INSERT INTO OrderItems (order_item_id, order_id, product_id, quantity, unit_price) VALUES
  (1,  1, 1, 1, 89.99),
  (2,  1, 2, 1, 199.50),
  (3,  2, 5, 1, 45.00),
  (4,  3, 3, 1, 349.00),
  (5,  4, 2, 1, 199.50),
  (6,  4, 7, 1, 12.00),
  (7,  5, 6, 1, 32.50),
  (8,  6, 1, 1, 89.99),
  (9,  7, 7, 1, 12.00);
`.trim(),
  },
  {
    slug: 'school',
    name: 'School',
    dialect: 'mysql',
    description: 'Students, Courses and Enrollments — used for LEFT JOIN and HAVING practice.',
    schemaSql: `
CREATE TABLE Students (
  student_id INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  grade      INTEGER NOT NULL,
  city       TEXT
);

CREATE TABLE Courses (
  course_id   INTEGER PRIMARY KEY,
  course_name TEXT NOT NULL,
  credits     INTEGER NOT NULL,
  teacher     TEXT
);

CREATE TABLE Enrollments (
  enrollment_id INTEGER PRIMARY KEY,
  student_id    INTEGER NOT NULL,
  course_id     INTEGER NOT NULL,
  score         INTEGER,
  FOREIGN KEY (student_id) REFERENCES Students(student_id),
  FOREIGN KEY (course_id) REFERENCES Courses(course_id)
);
`.trim(),
    seedSql: `
INSERT INTO Students (student_id, name, grade, city) VALUES
  (1, 'Ishaan Roy',   10, 'Kolkata'),
  (2, 'Meera Joshi',  10, 'Pune'),
  (3, 'Aditya Bose',  11, 'Kolkata'),
  (4, 'Zara Sheikh',  11, 'Chennai'),
  (5, 'Rohan Pillai', 12, 'Kochi'),
  (6, 'Tara Menon',   12, 'Kochi');

INSERT INTO Courses (course_id, course_name, credits, teacher) VALUES
  (1, 'Mathematics', 4, 'Mr Rao'),
  (2, 'Physics',     4, 'Ms Dutta'),
  (3, 'History',     3, 'Mr Iyer'),
  (4, 'Art',         2, 'Ms Kapoor');

INSERT INTO Enrollments (enrollment_id, student_id, course_id, score) VALUES
  (1,  1, 1, 88),
  (2,  1, 2, 74),
  (3,  2, 1, 91),
  (4,  2, 3, 65),
  (5,  3, 1, 55),
  (6,  3, 2, 82),
  (7,  4, 3, 78),
  (8,  5, 1, 95),
  (9,  5, 2, 89),
  (10, 5, 3, 71);
`.trim(),
  },
];
