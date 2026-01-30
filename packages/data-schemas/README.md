# Aipyq 数据模式包

本包使用 Mongoose ODM 为 Aipyq 提供数据库模式、模型、类型和方法。

## 📁 包结构

```
packages/data-schemas/
├── src/
│   ├── schema/         # Mongoose 模式定义
│   ├── models/         # 模型工厂函数
│   ├── types/          # TypeScript 类型定义
│   ├── methods/        # 数据库操作方法
│   ├── common/         # 共享常量和枚举
│   ├── config/         # 配置文件（winston 等）
│   └── index.ts        # 主包导出
```

## 🏗️ 架构模式

### 1. 模式文件 (`src/schema/`)

模式文件定义 Mongoose 模式结构。它们遵循以下约定：

- **命名**: 使用小写文件名（例如：`user.ts`、`accessRole.ts`）
- **导入**: 从 `~/types` 导入类型以支持 TypeScript
- **导出**: 仅将模式作为默认导出

**示例:**
```typescript
import { Schema } from 'mongoose';
import type { IUser } from '~/types';

const userSchema = new Schema<IUser>(
  {
    name: { type: String },
    email: { type: String, required: true },
    // ... other fields
  },
  { timestamps: true }
);

export default userSchema;
```

### 2. 类型定义 (`src/types/`)

类型文件定义 TypeScript 接口和类型。它们遵循以下约定：

- **基础类型**: 定义不包含 Mongoose Document 属性的普通类型
- **文档接口**: 使用 Document 和 `_id` 扩展基础类型
- **枚举/常量**: 将相关枚举放在类型文件中，如果是共享的则放在 `common/` 中

**示例:**
```typescript
import type { Document, Types } from 'mongoose';

export type User = {
  name?: string;
  email: string;
  // ... other fields
};

export type IUser = User &
  Document & {
    _id: Types.ObjectId;
  };
```

### 3. 模型工厂函数 (`src/models/`)

模型文件使用工厂函数创建 Mongoose 模型。它们遵循以下约定：

- **函数名**: `create[EntityName]Model`
- **单例模式**: 在创建前检查模型是否已存在
- **类型安全**: 使用类型中对应的接口

**示例:**
```typescript
import userSchema from '~/schema/user';
import type * as t from '~/types';

export function createUserModel(mongoose: typeof import('mongoose')) {
  return mongoose.models.User || mongoose.model<t.IUser>('User', userSchema);
}
```

### 4. 数据库方法 (`src/methods/`)

方法文件包含每个实体的数据库操作。它们遵循以下约定：

- **函数名**: `create[EntityName]Methods`
- **返回类型**: 为方法对象导出一个类型
- **操作**: 包括 CRUD 操作和特定实体的查询

**示例:**
```typescript
import type { Model } from 'mongoose';
import type { IUser } from '~/types';

export function createUserMethods(mongoose: typeof import('mongoose')) {
  async function findUserById(userId: string): Promise<IUser | null> {
    const User = mongoose.models.User as Model<IUser>;
    return await User.findById(userId).lean();
  }

  async function createUser(userData: Partial<IUser>): Promise<IUser> {
    const User = mongoose.models.User as Model<IUser>;
    return await User.create(userData);
  }

  return {
    findUserById,
    createUser,
    // ... other methods
  };
}

export type UserMethods = ReturnType<typeof createUserMethods>;
```

### 5. 主导出 (`src/index.ts`)

主索引文件导出：
- `createModels()` - 所有模型的工厂函数
- `createMethods()` - 所有方法的工厂函数
- 从 `~/types` 导出的类型
- 共享工具和常量

## 🚀 添加新实体

要向 data-schemas 包添加新实体，请按照以下步骤操作：

### 步骤 1: 创建类型定义

创建 `src/types/[entityName].ts`：

```typescript
import type { Document, Types } from 'mongoose';

export type EntityName = {
  /** Field description */
  fieldName: string;
  // ... other fields
};

export type IEntityName = EntityName &
  Document & {
    _id: Types.ObjectId;
  };
```

### 步骤 2: 更新类型索引

添加到 `src/types/index.ts`：

```typescript
export * from './entityName';
```

### 步骤 3: 创建模式

创建 `src/schema/[entityName].ts`：

```typescript
import { Schema } from 'mongoose';
import type { IEntityName } from '~/types';

const entityNameSchema = new Schema<IEntityName>(
  {
    fieldName: { type: String, required: true },
    // ... other fields
  },
  { timestamps: true }
);

export default entityNameSchema;
```

### 步骤 4: 创建模型工厂

创建 `src/models/[entityName].ts`：

```typescript
import entityNameSchema from '~/schema/entityName';
import type * as t from '~/types';

export function createEntityNameModel(mongoose: typeof import('mongoose')) {
  return (
    mongoose.models.EntityName || 
    mongoose.model<t.IEntityName>('EntityName', entityNameSchema)
  );
}
```

### 步骤 5: 更新模型索引

添加到 `src/models/index.ts`：

1. 导入工厂函数：
```typescript
import { createEntityNameModel } from './entityName';
```

2. 添加到 `createModels()` 的返回对象中：
```typescript
EntityName: createEntityNameModel(mongoose),
```

### 步骤 6: 创建数据库方法

创建 `src/methods/[entityName].ts`：

```typescript
import type { Model, Types } from 'mongoose';
import type { IEntityName } from '~/types';

export function createEntityNameMethods(mongoose: typeof import('mongoose')) {
  async function findEntityById(id: string | Types.ObjectId): Promise<IEntityName | null> {
    const EntityName = mongoose.models.EntityName as Model<IEntityName>;
    return await EntityName.findById(id).lean();
  }

  // ... other methods

  return {
    findEntityById,
    // ... other methods
  };
}

export type EntityNameMethods = ReturnType<typeof createEntityNameMethods>;
```

### 步骤 7: 更新方法索引

添加到 `src/methods/index.ts`：

1. 导入方法：
```typescript
import { createEntityNameMethods, type EntityNameMethods } from './entityName';
```

2. 添加到 `createMethods()` 的返回对象中：
```typescript
...createEntityNameMethods(mongoose),
```

3. 添加到 `AllMethods` 类型中：
```typescript
export type AllMethods = UserMethods &
  // ... other methods
  EntityNameMethods;
```

## 📝 最佳实践

1. **一致的命名**: 文件名使用小写，类型/接口使用 PascalCase
2. **类型安全**: 始终使用 TypeScript 类型，避免使用 `any`
3. **JSDoc 注释**: 为复杂字段和方法编写文档
4. **索引**: 在模式文件中定义数据库索引以提高查询性能
5. **验证**: 使用 Mongoose 模式验证以确保数据完整性
6. **精简查询**: 在不需要 Mongoose 文档方法的读取操作中使用 `.lean()`

## 🔧 常见模式

### 枚举和常量

将共享枚举放在 `src/common/` 中：

```typescript
// src/common/permissions.ts
export enum PermissionBits {
  VIEW = 1,
  EDIT = 2,
  DELETE = 4,
  SHARE = 8,
}
```

### 复合索引

对于复杂查询，添加复合索引：

```typescript
schema.index({ field1: 1, field2: 1 });
schema.index(
  { uniqueField: 1 },
  { 
    unique: true, 
    partialFilterExpression: { uniqueField: { $exists: true } }
  }
);
```

### 虚拟属性

使用虚拟属性添加计算属性：

```typescript
schema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});
```

## 🧪 测试

添加新实体时，请确保：
- 类型编译无错误
- 模型可以成功创建
- 方法处理边界情况（空值检查、验证）
- 为查询模式正确定义索引

## 📚 参考资料

- [Mongoose 文档](https://mongoosejs.com/docs/)
- [TypeScript 手册](https://www.typescriptlang.org/docs/)
- [MongoDB 索引](https://docs.mongodb.com/manual/indexes/) 